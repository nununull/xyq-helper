<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import CaptureCalibration from './CaptureCalibration.vue'
import CapturePreview from './CapturePreview.vue'
import AnswerOverlay from './AnswerOverlay.vue'
import CategorySelector from './CategorySelector.vue'
import SettingsPanel from './SettingsPanel.vue'
import { useScreenCapture } from '../composables/useScreenCapture'
import { useRecognitionController } from '../features/recognition/useRecognitionController'
import { getCaptureErrorMessage, useCaptureStore } from '../stores/capture'
import { useConfigStore } from '../stores/config'
import { useRecognitionStore } from '../stores/recognition'
import { applyQuestionRegion } from '../features/setup/applyCaptureRegion'
import { hasValidCaptureRegions } from '../types/config'
import type { CaptureRegion } from '../types/capture'
import { activityCategoryGroups } from '../data/activityCategories'
import { useAnswerPictureInPicture } from '../composables/useAnswerPictureInPicture'

const captureStore = useCaptureStore()
const configStore = useConfigStore()
const recognitionStore = useRecognitionStore()
const screenCapture = useScreenCapture()
const controller = useRecognitionController()
const answerPictureInPicture = useAnswerPictureInPicture()
const previewStream = shallowRef<MediaStream | null>(null)
const calibrating = ref(false)
const focusMode = ref(false)
const serviceReady = ref<boolean | null>(null)
let calibrationRevision = 0
const selectedCategoryId = computed(() => configStore.config.remoteQuery.categoryId)
const selectedCategoryName = computed(() => activityCategoryGroups.flatMap(group => group.categories)
  .find(category => category.id === selectedCategoryId.value)?.name ?? '')
const hasCalibration = computed(() => hasValidCaptureRegions(configStore.config.capture))
const questionRegion = computed(() => hasCalibration.value ? configStore.config.capture.questionRegion : null)
const captureStatusLabel = computed(() => ({ idle: '待连接', requesting: '选择窗口中', active: '已连接', paused: '已停止', error: '异常' }[captureStore.status]))
const actionHint = computed(() => {
  if (!selectedCategoryId.value) return '先选择活动，再连接游戏窗口。'
  if (calibrating.value) return '只框选题干文字；看图题只框选待识别的小图。不包含选项、倒计时、头像和装饰。'
  if (previewStream.value) return '只在题干稳定后查询175dt。同一画面只自动查询一次，换题后自动继续。'
  return '连接游戏窗口后框选题干。原始题干小图会发送到175dt识别。'
})

/** 检查当前站点是否具有175dt同源识别入口。 */
async function checkService(): Promise<void> {
  serviceReady.value = null
  try {
    const response = await fetch('/api/175dt/health', { signal: AbortSignal.timeout(3000) })
    const payload = await response.json()
    serviceReady.value = response.ok && payload.available === true
  } catch {
    serviceReady.value = false
  }
}

/** 使用175dt返回的答案文本播报，不推断选项字母。 */
function speakAnswer(): void {
  const answer = recognitionStore.candidates[0]?.answerText
  if (!configStore.config.overlay.speechEnabled || !answer || !('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(`答案，${answer}`)
  utterance.lang = 'zh-CN'
  utterance.rate = 1.12
  window.speechSynthesis.speak(utterance)
}
watch(() => recognitionStore.candidates[0], candidate => {
  if (candidate) speakAnswer()
  else window.speechSynthesis?.cancel()
})

/** 从本次点击直接请求窗口共享，避免丢失浏览器要求的用户手势。 */
async function startCapture(): Promise<void> {
  if (!selectedCategoryId.value || !serviceReady.value || captureStore.status === 'requesting' || previewStream.value) return
  try {
    captureStore.setStatus('requesting')
    if (!await screenCapture.startCapture()) return
    previewStream.value = screenCapture.getActiveStream()
    captureStore.setStatus('active')
    focusMode.value = true
    if (hasCalibration.value) controller.start()
    else calibrating.value = true
  } catch (error) {
    controller.stop()
    screenCapture.stopCapture()
    previewStream.value = null
    captureStore.setError(getCaptureErrorMessage(error))
  }
}

/** 停止共享、上传和播报，同时撤下上一题答案。 */
function stopCapture(): void {
  calibrationRevision += 1
  controller.stop()
  screenCapture.stopCapture()
  previewStream.value = null
  calibrating.value = false
  focusMode.value = false
  captureStore.lastFrame = null
  captureStore.setStatus('paused')
  window.speechSynthesis?.cancel()
}

/** 切换活动时废弃旧请求，沿用仍然打开的共享窗口。 */
async function selectCategory(categoryId: string): Promise<void> {
  if (categoryId === selectedCategoryId.value) return
  controller.stop()
  await configStore.selectActivityCategory(categoryId)
  if (previewStream.value && !calibrating.value && hasCalibration.value) controller.start()
}

/** 暂停上传，在当前共享画面上重新框选题干。 */
function beginCalibration(): void {
  calibrationRevision += 1
  controller.stop()
  calibrating.value = true
  focusMode.value = true
}

/** 保存题干选框和原始窗口尺寸，立即恢复自动识别。 */
async function completeCalibration(region: CaptureRegion, sourceSize: { width: number; height: number }): Promise<void> {
  const revision = ++calibrationRevision
  const stream = previewStream.value
  if (!stream || !calibrating.value) return
  try {
    await configStore.update(applyQuestionRegion(configStore.config, region, sourceSize))
    if (revision !== calibrationRevision || stream !== previewStream.value || !calibrating.value) return
    captureStore.error = ''
    calibrating.value = false
    controller.start()
  } catch (error) {
    if (revision === calibrationRevision) captureStore.error = error instanceof Error ? error.message : '保存题干选框失败'
  }
}

/** 取消重新框选，已有有效题干框时继续监测。 */
function cancelCalibration(): void {
  calibrationRevision += 1
  calibrating.value = false
  if (hasCalibration.value) controller.start()
}

/** 浏览器停止共享后释放界面状态和在途请求。 */
function handleCaptureEnded(): void {
  stopCapture()
  captureStore.error = '屏幕共享已停止，请重新连接游戏画面'
}

const unsubscribeCaptureEnded = screenCapture.onCaptureEnded(handleCaptureEnded)
onMounted(() => { void checkService() })
onBeforeUnmount(() => {
  unsubscribeCaptureEnded()
  stopCapture()
})
</script>

<template>
  <section class="dashboard">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">答</span>
        <div><h1>梦幻答题助手</h1><p>175dt截图搜题 · 稳定后查询</p></div>
      </div>
      <div class="topbar-actions">
        <span v-if="selectedCategoryName" class="selected-category-pill"><small>当前活动</small><strong>{{ selectedCategoryName }}</strong></span>
        <span class="status-pill" :data-status="captureStore.status"><i />{{ captureStatusLabel }}</span>
        <button class="floating-answer-action" type="button" :aria-pressed="answerPictureInPicture.opened.value" :disabled="!answerPictureInPicture.supported" @click="answerPictureInPicture.toggle">
          {{ answerPictureInPicture.opened.value ? '关闭悬浮' : '悬浮答案' }}
        </button>
        <button class="focus-action" type="button" :disabled="!previewStream" :aria-pressed="focusMode" @click="focusMode = !focusMode">{{ focusMode ? '退出专注' : '放大画面' }}</button>
        <button class="primary-action" type="button" :disabled="!selectedCategoryId || !serviceReady || captureStore.status === 'requesting' || Boolean(previewStream)" @click="startCapture">连接游戏画面</button>
        <button class="subtle-action" type="button" :disabled="!previewStream && captureStore.status !== 'requesting'" @click="stopCapture">停止</button>
        <button class="subtle-action" type="button" :disabled="!previewStream || calibrating" @click="controller.retry">手动重试</button>
        <button class="subtle-action" type="button" :disabled="!previewStream || calibrating" @click="beginCalibration">重新框选</button>
      </div>
    </header>
    <section v-if="serviceReady === false" class="panel service-unavailable" role="alert">
      <strong>当前站点未连接175dt识别服务</strong>
      <p>请通过本机的开发、预览或启动命令打开助手，纯静态托管页面无法完成截图上传。</p>
      <button type="button" @click="checkService">重新连接服务</button>
    </section>
    <div class="dashboard-grid" :class="{ 'focus-mode': focusMode }">
      <CategorySelector :selected-id="selectedCategoryId" @select="selectCategory" />
      <main class="workspace">
        <p class="panel flow-hint">{{ actionHint }}</p>
        <CaptureCalibration v-if="calibrating && previewStream" :stream="previewStream" @completed="completeCalibration" @cancel="cancelCalibration" />
        <CapturePreview v-else :stream="previewStream" :frame="captureStore.lastFrame" :question-region="questionRegion" :focus-mode="focusMode">
          <AnswerOverlay :candidates="recognitionStore.candidates" :message="recognitionStore.message" :phase="recognitionStore.phase" :running="recognitionStore.running" />
        </CapturePreview>
      </main>
      <aside class="rightbar">
        <section class="panel">
          <h2>识别状态</h2>
          <p role="status">{{ recognitionStore.message || '等待连接游戏画面' }}</p>
          <p>来源：175dt截图搜索</p>
          <p>本次已查询 {{ recognitionStore.requestCount }} 次</p>
          <p v-if="recognitionStore.durationMs !== null">最近耗时 {{ recognitionStore.durationMs }}ms</p>
          <p v-if="captureStore.error" class="error-text">{{ captureStore.error }}</p>
          <p class="muted">画面检查在本地完成，不等于向175dt发请求。</p>
        </section>
        <SettingsPanel />
      </aside>
    </div>
    <Teleport v-if="answerPictureInPicture.mountTarget.value" :to="answerPictureInPicture.mountTarget.value">
      <div class="floating-answer-shell"><AnswerOverlay compact :candidates="recognitionStore.candidates" :message="recognitionStore.message" :phase="recognitionStore.phase" :running="recognitionStore.running" /></div>
    </Teleport>
    <p v-if="answerPictureInPicture.error.value" class="floating-answer-error" role="alert">{{ answerPictureInPicture.error.value }}</p>
  </section>
</template>
