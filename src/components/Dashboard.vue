<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import CaptureCalibration from './CaptureCalibration.vue'
import CapturePreview from './CapturePreview.vue'
import AnswerOverlay from './AnswerOverlay.vue'
import CategorySelector from './CategorySelector.vue'
import OCRResult from './OCRResult.vue'
import QuestionBankManager from './QuestionBankManager.vue'
import SettingsPanel from './SettingsPanel.vue'
import UnknownQuestions from './UnknownQuestions.vue'
import { useOCR } from '../composables/useOCR'
import { useScreenCapture } from '../composables/useScreenCapture'
import { useRecognitionController } from '../features/recognition/useRecognitionController'
import { getCaptureErrorMessage, useCaptureStore } from '../stores/capture'
import { useConfigStore } from '../stores/config'
import { useMatcherStore } from '../stores/matcher'
import { useOCRStore } from '../stores/ocr'
import { useRecognitionStore } from '../stores/recognition'
import { parseQuestion } from '../utils/parseQuestion'
import type { RemoteAmbiguousCandidate } from '../types/remoteQuestion'
import { applyAnswerRegion } from '../features/setup/applyCaptureRegion'
import { hasValidCaptureRegions } from '../types/config'
import type { CaptureRegion } from '../types/capture'
import { activityCategoryGroups } from '../data/activityCategories'
import { useAnswerPictureInPicture } from '../composables/useAnswerPictureInPicture'

const captureStore = useCaptureStore()
const configStore = useConfigStore()
const ocrStore = useOCRStore()
const matcherStore = useMatcherStore()
const recognitionStore = useRecognitionStore()
const screenCapture = useScreenCapture()
const ocr = useOCR()
const controller = useRecognitionController()
const answerPictureInPicture = useAnswerPictureInPicture()
const previewStream = shallowRef<MediaStream | null>(null)
const calibrating = shallowRef(false)
const focusMode = shallowRef(false)
const activePage = shallowRef<'recognition' | 'questionBank'>('recognition')
const pageSwitching = shallowRef(false)
const ocrPreparationVisible = shallowRef(false)
const pendingCaptureAfterPreparation = shallowRef(false)
const ocrRuntimeLabel = computed(() => ({
  uninitialized: '尚未初始化',
  worker: 'Worker 后台线程',
  'main-thread': '主线程兼容模式',
  error: '初始化失败',
}[ocr.runtimeMode.value]))
const ocrPreparationPercent = computed(() => {
  if (!ocr.preparation.totalBytes) return 0
  return Math.min(100, Math.round(
    ocr.preparation.loadedBytes / ocr.preparation.totalBytes * 100,
  ))
})
const ocrPreparationBusy = computed(() => [
  'downloading',
  'loading-cache',
  'loading-runtime',
  'initializing',
].includes(ocr.preparation.phase))
const ocrPreparationTitle = computed(() => ({
  checking: '正在检查 OCR 组件',
  missing: '首次使用需要准备 OCR 组件',
  downloading: '正在下载 OCR 组件',
  'loading-cache': '正在读取本地 OCR 组件',
  'loading-runtime': '正在加载 OCR 运行环境',
  initializing: '正在初始化 OCR 引擎',
  ready: 'OCR 已准备完成',
  error: 'OCR 组件准备失败',
}[ocr.preparation.phase]))

/** 将内部捕获状态转换为面向用户的中文文案。 */
const captureStatusLabel = computed(() => ({
  idle: '待连接',
  requesting: '授权中',
  active: '识别中',
  paused: '已暂停',
  error: '异常',
}[captureStore.status] ?? captureStore.status))

const selectedCategoryId = computed(() => configStore.config.remoteQuery.categoryId)
const selectedCategoryName = computed(() => {
  for (const group of activityCategoryGroups) {
    const category = group.categories.find((item) => item.id === selectedCategoryId.value)
    if (category) return category.name
  }
  return ''
})
const hasCalibration = computed(() => hasValidCaptureRegions(configStore.config.capture))
const calibratedAnswerRegion = computed(() => {
  const capture = configStore.config.capture
  if (capture.answerRegion) return capture.answerRegion
  if (!capture.questionRegion || !capture.optionsRegion) return null
  const left = Math.min(capture.questionRegion.x, capture.optionsRegion.x)
  const top = Math.min(capture.questionRegion.y, capture.optionsRegion.y)
  const right = Math.max(
    capture.questionRegion.x + capture.questionRegion.width,
    capture.optionsRegion.x + capture.optionsRegion.width,
  )
  const bottom = Math.max(
    capture.questionRegion.y + capture.questionRegion.height,
    capture.optionsRegion.y + capture.optionsRegion.height,
  )
  return { x: left, y: top, width: right - left, height: bottom - top }
})
const actionHint = computed(() => {
  if (!selectedCategoryId.value) return '请先选择左侧活动分类，再连接游戏画面。'
  if (captureStore.status === 'requesting') return `已选择「${selectedCategoryName.value}」，正在等待浏览器共享授权。`
  if (calibrating.value) return '请在下方实时画面中依次框选题干和选项。'
  if (captureStore.status === 'active') return '游戏画面已连接，连续识别正在运行。'
  return hasCalibration.value
    ? `已选择「${selectedCategoryName.value}」，点击“连接游戏画面”开始识别。`
    : `已选择「${selectedCategoryName.value}」，连接游戏画面后请先完成区域校准。`
})
const parsedQuestion = computed(() => (
  ocrStore.lastResult ? parseQuestion(ocrStore.lastResult) : null
))
const displayedCandidates = computed(() => (
  matcherStore.remoteResults.length ? matcherStore.remoteResults : matcherStore.remoteCandidates
))

/** 播报新识别出的确定答案，避免用户频繁把视线移出游戏画面。 */
function speakAnswer(): void {
  const result = matcherStore.result
  if (!configStore.config.overlay.speechEnabled || !result || !('speechSynthesis' in window)) return

  const optionText = result.answerText?.trim()
    || (result.answer ? parsedQuestion.value?.options[result.answer] : '')
    || ''
  const answerText = [result.answer ? `答案 ${result.answer}` : '答案', optionText]
    .filter(Boolean)
    .join('，')
  const utterance = new SpeechSynthesisUtterance(answerText)
  utterance.lang = 'zh-CN'
  utterance.rate = 1.12
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
}

watch(
  () => matcherStore.result
    ? `${matcherStore.result.questionId}:${matcherStore.result.answer}:${matcherStore.result.answerText ?? ''}`
    : '',
  (signature, previousSignature) => {
    if (signature && signature !== previousSignature) speakAnswer()
  },
)
/** 获取屏幕共享，并根据区域配置进入校准或连续识别。 */
async function startCapture(): Promise<void> {
  if (
    !selectedCategoryId.value
    || captureStore.status === 'requesting'
    || captureStore.status === 'active'
  ) return

  try {
    captureStore.setStatus('requesting')
    const ownsCapture = await screenCapture.startCapture()
    if (!ownsCapture) return
    previewStream.value = screenCapture.getActiveStream()
    ocrPreparationVisible.value = true
    await ocr.initializeOCR()
    ocrPreparationVisible.value = false
    captureStore.setStatus('active')
    focusMode.value = true
    if (hasCalibration.value) {
      controller.start()
    } else {
      calibrating.value = true
    }
  } catch (error) {
    controller.stop()
    screenCapture.stopCapture()
    previewStream.value = null
    calibrating.value = false
    focusMode.value = false
    ocrPreparationVisible.value = ocr.preparation.phase === 'error'
    captureStore.setError(getCaptureErrorMessage(error))
  }
}

/** 根据本地缓存状态决定直接连接画面或先征求大文件下载确认。 */
function requestCapture(): void {
  if (
    !selectedCategoryId.value
    || captureStore.status === 'requesting'
    || captureStore.status === 'active'
  ) return

  if (ocr.preparation.phase === 'checking' || ocr.preparation.phase === 'missing') {
    pendingCaptureAfterPreparation.value = true
    ocrPreparationVisible.value = true
    return
  }

  void startCapture()
}

/** 从确认按钮发起屏幕授权，并在授权完成后下载与初始化 OCR。 */
function confirmOCRPreparation(): void {
  pendingCaptureAfterPreparation.value = false
  void startCapture()
}

/** 关闭首次下载提示并取消本次连接意图。 */
function cancelOCRPreparation(): void {
  if (ocrPreparationBusy.value) return
  pendingCaptureAfterPreparation.value = false
  ocrPreparationVisible.value = false
}

/** 将字节数格式化为适合下载提示展示的兆字节。 */
function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 停止连续识别与当前屏幕共享。 */
function stopCapture(): void {
  controller.stop()
  screenCapture.stopCapture()
  previewStream.value = null
  calibrating.value = false
  focusMode.value = false
  captureStore.setStatus('paused')
}

/** 切换活动分类前停止并重置旧分类识别上下文。 */
async function selectCategory(categoryId: string): Promise<void> {
  if (categoryId === selectedCategoryId.value) return
  controller.stop()
  controller.resetForCategory()
  screenCapture.stopCapture()
  previewStream.value = null
  calibrating.value = false
  focusMode.value = false
  captureStore.setStatus('paused')
  await configStore.selectActivityCategory(categoryId)
}

/** 处理用户从浏览器共享控件主动结束捕获。 */
function handleCaptureEnded(): void {
  controller.stop()
  previewStream.value = null
  calibrating.value = false
  focusMode.value = false
  captureStore.setStatus('paused')
  captureStore.error = '屏幕共享已停止，请重新连接游戏画面'
}

/** 暂停识别并在当前共享画面上重新校准。 */
function beginCalibration(): void {
  controller.stop()
  controller.resetForCategory()
  calibrating.value = true
  focusMode.value = true
}

/** 切换共享画面的专注布局，让用户按需显示或收起辅助面板。 */
function toggleFocusMode(): void {
  focusMode.value = !focusMode.value
}

/** 保存完整答题区域并立即启动连续识别。 */
async function completeCalibration(answerRegion: CaptureRegion): Promise<void> {
  await configStore.update(applyAnswerRegion(configStore.config, answerRegion))
  calibrating.value = false
  controller.start()
}

/** 取消校准；存在旧有效区域时恢复连续识别。 */
function cancelCalibration(): void {
  calibrating.value = false
  if (hasCalibration.value) controller.start()
}

/** 将用户人工确认的远程候选交给识别控制器保存并展示。 */
async function selectRemoteCandidate(candidate: RemoteAmbiguousCandidate): Promise<void> {
  if (!parsedQuestion.value) return
  await controller.selectCandidate(candidate, parsedQuestion.value)
}

/** 让浏览器先绘制点击反馈，再挂载数据量较大的题库页面。 */
async function switchPage(page: 'recognition' | 'questionBank'): Promise<void> {
  if (pageSwitching.value || activePage.value === page) return
  pageSwitching.value = true
  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  activePage.value = page
  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  pageSwitching.value = false
}

/** 打开题库维护页前停止捕获，避免后台识别继续运行。 */
function openQuestionBank(): void {
  stopCapture()
  void switchPage('questionBank')
}

/** 返回实时识别页面。 */
function closeQuestionBank(): void {
  void switchPage('recognition')
}

const unsubscribeCaptureEnded = screenCapture.onCaptureEnded(handleCaptureEnded)

onMounted(() => {
  void ocr.inspectAssets()
})

onBeforeUnmount(() => {
  unsubscribeCaptureEnded()
  controller.stop()
  screenCapture.stopCapture()
  window.speechSynthesis?.cancel()
  void ocr.terminateOCR()
})
</script>

<template>
  <section class="dashboard">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">答</span>
        <div>
          <h1>梦幻答题助手</h1>
          <p>本地识别 · 答案不离开浏览器</p>
        </div>
      </div>
      <div class="topbar-actions">
        <button
          class="ghost-action"
          type="button"
          :disabled="pageSwitching"
          @click="activePage === 'recognition' ? openQuestionBank() : closeQuestionBank()"
        >
          {{ activePage === 'recognition' ? '题库维护' : '返回识别' }}
        </button>
        <template v-if="activePage === 'recognition'">
          <span
            v-if="selectedCategoryName"
            :key="selectedCategoryId"
            class="selected-category-pill"
            title="当前活动分类"
          >
            <small>当前活动</small>
            <strong>{{ selectedCategoryName }}</strong>
          </span>
          <span class="status-pill" :data-status="captureStore.status">
            <i />{{ captureStatusLabel }}
          </span>
          <button
            class="floating-answer-action"
            :class="{ active: answerPictureInPicture.opened.value }"
            type="button"
            :aria-pressed="answerPictureInPicture.opened.value"
            :disabled="!answerPictureInPicture.supported"
            :title="answerPictureInPicture.supported
              ? '打开始终置顶的小窗，可拖到游戏答题区域旁边'
              : '请使用最新版 Chrome 或 Edge'"
            @click="answerPictureInPicture.toggle"
          >
            {{ answerPictureInPicture.opened.value ? '关闭悬浮' : '悬浮答案' }}
          </button>
          <button
            class="focus-action"
            :class="{ active: focusMode }"
            type="button"
            :aria-pressed="focusMode"
            :disabled="!previewStream"
            @click="toggleFocusMode"
          >
            {{ focusMode ? '退出专注' : '放大画面' }}
          </button>
          <button
            class="primary-action"
            type="button"
            :disabled="!selectedCategoryId || captureStore.status === 'requesting' || captureStore.status === 'active'"
            @click="requestCapture"
          >
            连接游戏画面
          </button>
          <button
            class="subtle-action"
            type="button"
            :disabled="captureStore.status !== 'active' && captureStore.status !== 'requesting'"
            @click="stopCapture"
          >
            停止
          </button>
          <button
            class="subtle-action"
            type="button"
            :disabled="captureStore.status !== 'active' || calibrating"
            @click="controller.retry"
          >
            手动重试
          </button>
          <button
            class="subtle-action"
            type="button"
            :disabled="captureStore.status !== 'active' || calibrating"
            @click="beginCalibration"
          >
            重新校准
          </button>
        </template>
      </div>
    </header>

    <div v-if="pageSwitching" class="page-switch-feedback" role="status">
      <span class="page-switch-spinner" />
      {{ activePage === 'recognition' ? '正在打开题库…' : '正在返回识别…' }}
    </div>

    <QuestionBankManager v-if="activePage === 'questionBank'" @close="closeQuestionBank" />

    <div v-else class="dashboard-grid" :class="{ 'focus-mode': focusMode }">
      <CategorySelector :selected-id="selectedCategoryId" @select="selectCategory" />

      <main class="workspace">
        <p class="panel flow-hint">{{ actionHint }}</p>
        <CaptureCalibration
          v-if="calibrating && previewStream"
          :stream="previewStream"
          :initial-answer-region="calibratedAnswerRegion"
          @completed="completeCalibration"
          @cancel="cancelCalibration"
        />
        <CapturePreview
          v-else
          :stream="previewStream"
          :frame="captureStore.lastFrame"
          :question-region="calibratedAnswerRegion"
          :focus-mode="focusMode"
        >
          <AnswerOverlay
            :result="matcherStore.result"
            :candidates="displayedCandidates"
            :parsed-question="parsedQuestion"
            :message="recognitionStore.message"
            @select="selectRemoteCandidate"
          />
        </CapturePreview>
      </main>

      <aside class="rightbar">
        <OCRResult :result="ocrStore.lastResult" :parsed="parsedQuestion" />
        <section class="panel">
          <h2>状态</h2>
          <p>阶段：{{ recognitionStore.message }}</p>
          <p>OCR 引擎：{{ ocrRuntimeLabel }}</p>
          <p v-if="matcherStore.result?.resultSource">来源：{{ matcherStore.result.resultSource }}</p>
          <p v-if="matcherStore.result?.durationMs">总耗时：{{ matcherStore.result.durationMs }}ms</p>
          <p v-if="matcherStore.result?.warning" class="warning-text">{{ matcherStore.result.warning }}</p>
          <p v-if="captureStore.error" class="error-text">{{ captureStore.error }}</p>
          <p v-if="matcherStore.error" class="error-text">{{ matcherStore.error }}</p>
        </section>
        <SettingsPanel />
        <UnknownQuestions />
      </aside>
    </div>

    <Teleport v-if="answerPictureInPicture.mountTarget.value" :to="answerPictureInPicture.mountTarget.value">
      <div class="floating-answer-shell">
        <AnswerOverlay
          compact
          :result="matcherStore.result"
          :candidates="displayedCandidates"
          :parsed-question="parsedQuestion"
          :message="recognitionStore.message"
          @select="selectRemoteCandidate"
        />
      </div>
    </Teleport>

    <p v-if="answerPictureInPicture.error.value" class="floating-answer-error" role="alert">
      {{ answerPictureInPicture.error.value }}
    </p>

    <div v-if="ocrPreparationVisible" class="ocr-preparation-backdrop">
      <section
        class="panel ocr-preparation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ocr-preparation-title"
      >
        <div class="ocr-preparation-heading">
          <span class="ocr-preparation-icon" aria-hidden="true">OCR</span>
          <div>
            <h2 id="ocr-preparation-title">{{ ocrPreparationTitle }}</h2>
            <p v-if="ocr.preparation.phase === 'missing'">
              首次识别需要下载约 {{ formatMegabytes(ocr.preparation.totalBytes) }} 的本地组件，
              下载后将保存在浏览器中，后续通常无需重复下载。
            </p>
            <p v-else-if="ocr.preparation.phase === 'error'" class="error-text">
              {{ ocr.preparation.error }}
            </p>
            <p v-else>{{ ocr.preparation.currentAsset }}</p>
          </div>
        </div>

        <div v-if="ocrPreparationBusy" class="ocr-preparation-progress" role="status" aria-live="polite">
          <div class="ocr-progress-track">
            <span :style="{ width: `${ocrPreparationPercent}%` }" />
          </div>
          <div class="ocr-progress-meta">
            <span>{{ ocr.preparation.currentAsset }}</span>
            <strong v-if="ocr.preparation.phase === 'downloading' || ocr.preparation.phase === 'loading-cache'">
              {{ ocrPreparationPercent }}%
            </strong>
          </div>
          <small v-if="ocr.preparation.phase === 'downloading'">
            已准备 {{ formatMegabytes(ocr.preparation.loadedBytes) }} /
            {{ formatMegabytes(ocr.preparation.totalBytes) }}
          </small>
        </div>

        <div class="ocr-preparation-actions">
          <button
            v-if="ocr.preparation.phase === 'missing' && pendingCaptureAfterPreparation"
            class="subtle-action"
            type="button"
            @click="cancelOCRPreparation"
          >
            暂不使用
          </button>
          <button
            v-if="ocr.preparation.phase === 'missing' && pendingCaptureAfterPreparation"
            class="primary-action"
            type="button"
            @click="confirmOCRPreparation"
          >
            下载并连接画面
          </button>
          <button
            v-else-if="ocr.preparation.phase === 'error'"
            class="primary-action"
            type="button"
            @click="confirmOCRPreparation"
          >
            重新尝试
          </button>
          <button
            v-else-if="ocr.preparation.phase === 'ready'"
            class="primary-action"
            type="button"
            @click="ocrPreparationVisible = false"
          >
            完成
          </button>
        </div>
      </section>
    </div>
  </section>
</template>
