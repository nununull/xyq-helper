<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { CaptureFrame } from '../types/capture'
import type { MatchResult } from '../types/match'
import type { RemoteAmbiguousCandidate } from '../types/remoteQuestion'

const props = defineProps<{
  stream: MediaStream | null
  frame: CaptureFrame | null
  result: MatchResult | null
  candidates: RemoteAmbiguousCandidate[]
  recognitionMessage: string
}>()

const video = ref<HTMLVideoElement | null>(null)
const hasFrame = computed(() => Boolean(props.frame))
const hasAnswerContent = computed(() => Boolean(props.result || props.candidates.length))

/** 将仍在运行的共享流绑定到预览视频。 */
async function bindStream(): Promise<void> {
  await nextTick()
  if (!video.value) return
  if (video.value.srcObject !== props.stream) video.value.srcObject = props.stream
  if (props.stream) await video.value.play()
}

/** 格式化候选答案置信度。 */
function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`
}

watch(() => props.stream, () => void bindStream())
onMounted(() => void bindStream())
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
      <video ref="video" muted playsinline />

      <aside class="preview-answer-board" :class="{ empty: !hasAnswerContent }">
        <template v-if="result">
          <div class="preview-answer-title">识别答案</div>
          <div class="preview-answer-value">
            <strong>{{ result.answer || result.answerText }}</strong>
            <span>{{ formatConfidence(result.confidence) }}</span>
          </div>
          <p class="preview-matched-question">{{ result.matchedQuestion }}</p>
        </template>

        <template v-else-if="candidates.length">
          <div class="preview-answer-title">候选答案</div>
          <ol class="preview-candidate-list">
            <li v-for="(candidate, index) in candidates" :key="`${candidate.question}-${index}`">
              <div>
                <strong>{{ candidate.answerText }}</strong>
                <span>{{ formatConfidence(candidate.confidence) }}</span>
              </div>
              <p>{{ candidate.question }}</p>
            </li>
          </ol>
        </template>

        <template v-else>
          <div class="preview-answer-title">正在识别</div>
          <p>{{ recognitionMessage }}</p>
        </template>
      </aside>
    </div>
    <p v-else class="muted">暂无共享画面，请先连接游戏窗口。</p>
  </section>
</template>
