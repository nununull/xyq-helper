<script setup lang="ts">
import { computed } from 'vue'
import type { MatchResult } from '../types/match'
import type { ParsedQuestion } from '../types/question'
import type { RecognitionPhase, RemoteMatchPreview } from '../types/remoteQuestion'

const props = withDefaults(defineProps<{
  result: MatchResult | null
  candidates?: RemoteMatchPreview[]
  parsedQuestion: ParsedQuestion | null
  message: string
  phase?: RecognitionPhase
  running?: boolean
  compact?: boolean
}>(), {
  compact: false,
  candidates: () => [],
  phase: 'idle',
  running: false,
})

const busyPhases = new Set<RecognitionPhase>([
  'capturing',
  'recognizing',
  'stabilizing',
  'cacheLookup',
  'localLookup',
  'primaryQuery',
  'fallbackQuery',
  'matching',
])

/** 判断识别管线是否正在处理当前题目。 */
const isBusy = computed(() => props.running && busyPhases.has(props.phase))

/** 将流程阶段归纳为稳定的视觉状态，避免仅靠颜色传达含义。 */
const activityTone = computed(() => {
  if (isBusy.value) return 'busy'
  if (props.phase === 'showingAnswer') return 'success'
  if (props.phase === 'waitingRetry') return 'warning'
  return 'idle'
})

/** 生成始终可见的识别状态文案。 */
const activityLabel = computed(() => {
  if (props.message) return props.message
  if (props.running) return '正在监测题目画面'
  return props.phase === 'paused' ? '连续识别已暂停' : '等待开始识别'
})

/** 获取最终答案文本，避免把随题目排版变化的选项字母作为展示答案。 */
function getAnswerText(): string {
  const result = props.result
  if (!result) return ''
  const answerText = result.answerText?.trim()
  if (answerText && answerText !== result.answer) return answerText
  return ''
}

/** 格式化识别置信度。 */
function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`
}

/** 将题库题目中与 OCR 题干重合的连续字符标为高亮。 */
function highlightQuestion(question: string): Array<{ text: string; matched: boolean }> {
  const recognized = (props.parsedQuestion?.questionText ?? '').replace(/[^㐀-鿿0-9a-z]/gi, '')
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
</script>

<template>
  <aside class="answer-overlay" :class="{ compact }" aria-live="polite">
    <div class="answer-overlay-title">
      <span class="answer-overlay-heading">题目与答案</span>
      <span
        class="recognition-activity"
        :class="`is-${activityTone}`"
        role="status"
        :aria-label="activityLabel"
        :title="activityLabel"
      >
        <i aria-hidden="true" />
        <span>{{ activityLabel }}</span>
      </span>
    </div>

    <article v-if="result" class="overlay-result">
      <p class="overlay-question">
        <span
          v-for="(segment, index) in highlightQuestion(result.matchedQuestion)"
          :key="index"
          :class="{ 'matched-keyword': segment.matched }"
        >{{ segment.text }}</span>
      </p>
      <div class="overlay-answer">
        <span>答案</span>
        <strong>{{ getAnswerText() || '暂无答案文本' }}</strong>
        <small>{{ formatConfidence(result.confidence) }}</small>
      </div>
    </article>

    <section v-if="candidates.length" class="overlay-ranked-results">
      <div class="overlay-ranked-title">模糊匹配结果</div>
      <ol>
        <li
          v-for="(candidate, index) in candidates"
          :key="`${candidate.question}-${candidate.answerText}`"
          :class="{ primary: index === 0 }"
        >
          <span class="overlay-rank">{{ index + 1 }}</span>
          <div>
            <p>
              <span
                v-for="(segment, segmentIndex) in highlightQuestion(candidate.question)"
                :key="segmentIndex"
                :class="{ 'matched-keyword': segment.matched }"
              >{{ segment.text }}</span>
            </p>
            <strong>{{ candidate.answerText }}</strong>
          </div>
          <small>{{ formatConfidence(candidate.confidence) }}</small>
        </li>
      </ol>
    </section>

    <p v-if="!result && !candidates.length" class="overlay-waiting">{{ message || '等待识别题目' }}</p>
  </aside>
</template>
