<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef } from 'vue'
import CaptureCalibration from './CaptureCalibration.vue'
import CapturePreview from './CapturePreview.vue'
import CategorySelector from './CategorySelector.vue'
import OCRResult from './OCRResult.vue'
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
import { applyCaptureRegions } from '../features/setup/applyCaptureRegion'
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

const selectedCategoryId = computed(() => configStore.config.remoteQuery.categoryId)
const hasCalibration = computed(() => hasValidCaptureRegions(configStore.config.capture))
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
const matchedAnswerText = computed(() => {
  const result = matcherStore.result
  if (!result) return ''
  const answerText = result.answerText?.trim()
  if (answerText && answerText !== result.answer) return answerText
  return result.answer ? (parsedQuestion.value?.options[result.answer] ?? '') : ''
})

/** 格式化候选答案置信度。 */
function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`
}

/** 将候选题中与 OCR 题干重合的连续字符分段，供界面标红。 */
function highlightQuestion(question: string): Array<{ text: string; matched: boolean }> {
  const recognized = (parsedQuestion.value?.questionText ?? '').replace(/[^㐀-鿿0-9a-z]/gi, '')
  if (recognized.length < 2) return [{ text: question, matched: false }]

  const matchedIndexes = new Set<number>()
  for (let index = 0; index < question.length - 1; index += 1) {
    const pair = question.slice(index, index + 2)
    if (/^[㐀-鿿0-9a-z]{2}$/i.test(pair) && recognized.includes(pair)) {
      matchedIndexes.add(index)
      matchedIndexes.add(index + 1)
    }
  }

  const segments: Array<{ text: string; matched: boolean }> = []
  for (let index = 0; index < question.length; index += 1) {
    const matched = matchedIndexes.has(index)
    const previous = segments.at(-1)
    if (previous?.matched === matched) previous.text += question[index]
    else segments.push({ text: question[index], matched })
  }
  return segments
}

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
    captureStore.setError(getCaptureErrorMessage(error))
  }
}

/** 停止连续识别与当前屏幕共享。 */
function stopCapture(): void {
  controller.stop()
  screenCapture.stopCapture()
  previewStream.value = null
  calibrating.value = false
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
  captureStore.setStatus('paused')
  await configStore.selectActivityCategory(categoryId)
}

/** 处理用户从浏览器共享控件主动结束捕获。 */
function handleCaptureEnded(): void {
  controller.stop()
  previewStream.value = null
  calibrating.value = false
  captureStore.setStatus('paused')
  captureStore.error = '屏幕共享已停止，请重新连接游戏画面'
}

/** 暂停识别并在当前共享画面上重新校准。 */
function beginCalibration(): void {
  controller.stop()
  controller.resetForCategory()
  calibrating.value = true
}

/** 保存两个视频像素区域并立即启动连续识别。 */
async function completeCalibration(
  questionRegion: CaptureRegion,
  optionsRegion: CaptureRegion,
): Promise<void> {
  await configStore.update(applyCaptureRegions(
    configStore.config,
    questionRegion,
    optionsRegion,
  ))
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
      <div>
        <h1>xyq_helper</h1>
        <p>纯前端识别，答案提示仅显示在浏览器窗口内。</p>
      </div>
      <div class="topbar-actions">
        <span class="status-pill">{{ captureStore.status }}</span>
        <button
          type="button"
          :disabled="!selectedCategoryId || captureStore.status === 'requesting' || captureStore.status === 'active'"
          @click="startCapture"
        >
          连接游戏画面
        </button>
        <button
          type="button"
          :disabled="captureStore.status !== 'active' && captureStore.status !== 'requesting'"
          @click="stopCapture"
        >
          停止
        </button>
        <button
          type="button"
          :disabled="captureStore.status !== 'active' || calibrating"
          @click="controller.retry"
        >
          手动重试
        </button>
        <button
          type="button"
          :disabled="captureStore.status !== 'active' || calibrating"
          @click="beginCalibration"
        >
          重新校准
        </button>
      </div>
    </header>

    <div class="dashboard-grid">
      <CategorySelector :selected-id="selectedCategoryId" @select="selectCategory" />

      <main class="workspace">
        <p class="panel flow-hint">{{ actionHint }}</p>
        <CaptureCalibration
          v-if="calibrating && previewStream"
          :stream="previewStream"
          :initial-question-region="configStore.config.capture.questionRegion"
          :initial-options-region="configStore.config.capture.optionsRegion"
          @completed="completeCalibration"
          @cancel="cancelCalibration"
        />
        <CapturePreview
          v-else
          :stream="previewStream"
          :frame="captureStore.lastFrame"
        />
      </main>

      <aside class="rightbar">
        <section class="panel recognition-result-panel">
          <h2>题目与答案</h2>
          <article v-if="matcherStore.result" class="preview-question-answer-pair">
            <p class="preview-matched-question">
              <span class="preview-pair-label">题目</span>
              <span
                v-for="(segment, segmentIndex) in highlightQuestion(matcherStore.result.matchedQuestion)"
                :key="segmentIndex"
                :class="{ 'matched-keyword': segment.matched }"
              >{{ segment.text }}</span>
            </p>
            <div class="preview-answer-value">
              <strong><span class="preview-pair-label">答案</span>{{ matchedAnswerText || '暂无答案文本' }}</strong>
              <span>{{ formatConfidence(matcherStore.result.confidence) }}</span>
            </div>
          </article>

          <ol v-else-if="displayedCandidates.length" class="preview-candidate-list">
            <li
              v-for="(candidate, index) in displayedCandidates"
              :key="`${candidate.question}-${index}`"
            >
              <p>
                <span class="preview-pair-label">题目</span>
                <span
                  v-for="(segment, segmentIndex) in highlightQuestion(candidate.question)"
                  :key="segmentIndex"
                  :class="{ 'matched-keyword': segment.matched }"
                >{{ segment.text }}</span>
              </p>
              <div>
                <strong><span class="preview-pair-label">答案</span>{{ candidate.answerText }}</strong>
                <span>{{ formatConfidence(candidate.confidence) }}</span>
              </div>
              <button type="button" @click="selectRemoteCandidate(candidate)">选择</button>
            </li>
          </ol>

          <p v-else class="muted">{{ recognitionStore.message || '等待识别题目' }}</p>
        </section>
        <OCRResult :result="ocrStore.lastResult" :parsed="parsedQuestion" />
        <section class="panel">
          <h2>状态</h2>
          <p>阶段：{{ recognitionStore.message }}</p>
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
