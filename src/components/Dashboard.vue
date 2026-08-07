<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, shallowRef } from 'vue'
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

const captureStore = useCaptureStore()
const configStore = useConfigStore()
const ocrStore = useOCRStore()
const matcherStore = useMatcherStore()
const recognitionStore = useRecognitionStore()
const screenCapture = useScreenCapture()
const ocr = useOCR()
const controller = useRecognitionController()
const previewStream = shallowRef<MediaStream | null>(null)
const calibrating = shallowRef(false)
const focusMode = shallowRef(false)
const activePage = shallowRef<'recognition' | 'questionBank'>('recognition')
const pageSwitching = shallowRef(false)
const ocrRuntimeLabel = computed(() => ({
  uninitialized: '尚未初始化',
  worker: 'Worker 后台线程',
  'main-thread': '主线程兼容模式',
  error: '初始化失败',
}[ocr.runtimeMode.value]))

/** 将内部捕获状态转换为面向用户的中文文案。 */
const captureStatusLabel = computed(() => ({
  idle: '待连接',
  requesting: '授权中',
  active: '识别中',
  paused: '已暂停',
  error: '异常',
}[captureStore.status] ?? captureStore.status))

const selectedCategoryId = computed(() => configStore.config.remoteQuery.categoryId)
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
  if (captureStore.status === 'requesting') return '正在等待浏览器共享授权，请在弹出的窗口中选择游戏窗口。'
  if (calibrating.value) return '请在下方实时画面中依次框选题干和选项。'
  if (captureStore.status === 'active') return '游戏画面已连接，连续识别正在运行。'
  return hasCalibration.value
    ? '点击“连接游戏画面”，授权成功后会自动开始识别。'
    : '点击“连接游戏画面”，授权后先完成一次区域校准。'
})
const parsedQuestion = computed(() => (
  ocrStore.lastResult ? parseQuestion(ocrStore.lastResult) : null
))
const displayedCandidates = computed(() => (
  matcherStore.remoteResults.length ? matcherStore.remoteResults : matcherStore.remoteCandidates
))
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
    captureStore.setError(getCaptureErrorMessage(error))
  }
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

onBeforeUnmount(() => {
  unsubscribeCaptureEnded()
  controller.stop()
  screenCapture.stopCapture()
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
          <span class="status-pill" :data-status="captureStore.status">
            <i />{{ captureStatusLabel }}
          </span>
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
            @click="startCapture"
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
  </section>
</template>
