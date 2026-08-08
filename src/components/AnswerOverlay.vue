<script setup lang="ts">
import type { MatchResult } from '../types/match'
import type { ParsedQuestion } from '../types/question'
import type { RemoteAmbiguousCandidate } from '../types/remoteQuestion'

const props = withDefaults(defineProps<{
  result: MatchResult | null
  candidates: RemoteAmbiguousCandidate[]
  parsedQuestion: ParsedQuestion | null
  message: string
  compact?: boolean
}>(), {
  compact: false,
})

const emit = defineEmits<{
  select: [candidate: RemoteAmbiguousCandidate]
}>()

/** 获取最终答案文本，优先采用题库返回的完整答案。 */
function getAnswerText(): string {
  const result = props.result
  if (!result) return ''
  const answerText = result.answerText?.trim()
  if (answerText && answerText !== result.answer) return answerText
  return result.answer ? (props.parsedQuestion?.options[result.answer] ?? result.answer) : ''
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
      <span class="answer-overlay-dot" />
      题目与答案
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
        <b v-if="result.answer" class="overlay-answer-key">{{ result.answer }}</b>
        <strong>{{ getAnswerText() || '暂无答案文本' }}</strong>
        <small>{{ formatConfidence(result.confidence) }}</small>
      </div>
    </article>

    <ol v-else-if="candidates.length" class="overlay-candidates">
      <li v-for="(candidate, index) in candidates" :key="`${candidate.question}-${index}`">
        <p>
          <span
            v-for="(segment, segmentIndex) in highlightQuestion(candidate.question)"
            :key="segmentIndex"
            :class="{ 'matched-keyword': segment.matched }"
          >{{ segment.text }}</span>
        </p>
        <div>
          <strong>{{ candidate.answerText }}</strong>
          <small>{{ formatConfidence(candidate.confidence) }}</small>
        </div>
        <button type="button" @click="emit('select', candidate)">采用此答案</button>
      </li>
    </ol>

    <p v-else class="overlay-waiting">{{ message || '等待识别题目' }}</p>
  </aside>
</template>
