<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CaptureFrame, CaptureRegion } from '../types/capture'
import type { MatchResult } from '../types/match'
import type { RemoteAmbiguousCandidate } from '../types/remoteQuestion'

const props = defineProps<{
  stream: MediaStream | null
  frame: CaptureFrame | null
  result: MatchResult | null
  candidates: RemoteAmbiguousCandidate[]
  recognitionMessage: string
  recognizedQuestion: string
  optionsRegion: CaptureRegion | null
}>()

const emit = defineEmits<{
  selectCandidate: [candidate: RemoteAmbiguousCandidate]
}>()

const video = ref<HTMLVideoElement | null>(null)
const videoMetrics = ref({ sourceWidth: 0, sourceHeight: 0, width: 0, height: 0 })
const hasFrame = computed(() => Boolean(props.frame))
const hasAnswerContent = computed(() => Boolean(props.result || props.candidates.length))
const answerBoxStyle = computed(() => {
  const answer = props.result?.answer
  const region = props.optionsRegion
  const metrics = videoMetrics.value
  const isReliable = Boolean(answer) && (
    (props.result?.confidence ?? 0) >= 0.82
    || props.result?.source === '175dt-manual'
  )
  if (!answer || !region || !isReliable || !metrics.sourceWidth || !metrics.sourceHeight) return null

  const optionIndex = ['A', 'B', 'C', 'D'].indexOf(answer)
  if (optionIndex < 0) return null
  const rowHeight = region.height / 4
  return {
    left: `${region.x / metrics.sourceWidth * metrics.width}px`,
    top: `${(region.y + optionIndex * rowHeight) / metrics.sourceHeight * metrics.height}px`,
    width: `${region.width / metrics.sourceWidth * metrics.width}px`,
    height: `${rowHeight / metrics.sourceHeight * metrics.height}px`,
  }
})

/** 将仍在运行的共享流绑定到预览视频。 */
async function bindStream(): Promise<void> {
  await nextTick()
  if (!video.value) return
  if (video.value.srcObject !== props.stream) video.value.srcObject = props.stream
  if (props.stream) await video.value.play()
  updateVideoMetrics()
}

/** 同步视频源尺寸和页面展示尺寸，用于定位答案选项框。 */
function updateVideoMetrics(): void {
  const element = video.value
  if (!element) return
  videoMetrics.value = {
    sourceWidth: element.videoWidth,
    sourceHeight: element.videoHeight,
    width: element.clientWidth,
    height: element.clientHeight,
  }
}

/** 格式化候选答案置信度。 */
function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`
}

/** 将候选题中与 OCR 题干重合的连续字符分段，供界面标红。 */
function highlightQuestion(question: string): Array<{ text: string; matched: boolean }> {
  const recognized = props.recognizedQuestion.replace(/[^㐀-鿿0-9a-z]/gi, '')
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

watch(() => props.stream, () => void bindStream())
onMounted(() => {
  window.addEventListener('resize', updateVideoMetrics)
  void bindStream()
})
onBeforeUnmount(() => window.removeEventListener('resize', updateVideoMetrics))
</script>

<template>
  <section class="panel capture-preview-panel">
    <div class="capture-preview-header">
      <h2>共享画面</h2>
      <span v-if="hasFrame" class="muted">
        最近识别：{{ new Date(frame!.capturedAt).toLocaleTimeString() }}
      </span>
    </div>
    <div v-if="stream" class="capture-preview-stage">
      <video ref="video" muted playsinline @loadedmetadata="updateVideoMetrics" />
      <div v-if="answerBoxStyle" class="preview-answer-box" :style="answerBoxStyle">
        {{ result?.answer }}
      </div>

      <aside class="preview-answer-board" :class="{ empty: !hasAnswerContent }">
        <template v-if="result">
          <div class="preview-answer-title">识别答案</div>
          <div class="preview-answer-value">
            <strong>{{ result.answer || result.answerText }}</strong>
            <span>{{ formatConfidence(result.confidence) }}</span>
          </div>
          <p class="preview-matched-question">
            <span
              v-for="(segment, segmentIndex) in highlightQuestion(result.matchedQuestion)"
              :key="segmentIndex"
              :class="{ 'matched-keyword': segment.matched }"
            >{{ segment.text }}</span>
          </p>
        </template>

        <template v-if="candidates.length">
          <div class="preview-answer-title">候选答案</div>
          <ol class="preview-candidate-list">
            <li v-for="(candidate, index) in candidates" :key="`${candidate.question}-${index}`">
              <div>
                <strong>{{ candidate.answerText }}</strong>
                <span>{{ formatConfidence(candidate.confidence) }}</span>
              </div>
              <p>
                <span
                  v-for="(segment, segmentIndex) in highlightQuestion(candidate.question)"
                  :key="segmentIndex"
                  :class="{ 'matched-keyword': segment.matched }"
                >{{ segment.text }}</span>
              </p>
              <button type="button" @click="emit('selectCandidate', candidate)">选择</button>
            </li>
          </ol>
        </template>

        <template v-if="!result && !candidates.length">
          <div class="preview-answer-title">正在识别</div>
          <p>{{ recognitionMessage }}</p>
        </template>
      </aside>
    </div>
    <p v-else class="muted">暂无共享画面，请先连接游戏窗口。</p>
  </section>
</template>
