<script setup lang="ts">
import { computed } from 'vue'
import type { RecognitionPhase, RemoteQuestionCandidate } from '../types/remoteQuestion'

const props = withDefaults(defineProps<{
  candidates: RemoteQuestionCandidate[]
  message: string
  phase?: RecognitionPhase
  running?: boolean
  compact?: boolean
}>(), { compact: false, phase: 'idle', running: false })
const primary = computed(() => props.candidates[0])
const remaining = computed(() => props.candidates.slice(1))
const busy = computed(() => props.running && ['primaryQuery', 'recognizing', 'stabilizing'].includes(props.phase))
const tone = computed(() => busy.value ? 'busy' : props.phase === 'showingAnswer' ? 'success' : props.phase === 'waitingRetry' ? 'warning' : 'idle')
</script>

<template>
  <aside class="answer-overlay" :class="{ compact }" aria-live="polite">
    <div class="answer-overlay-title">
      <span class="answer-overlay-heading">175dt题目与答案</span>
      <span class="recognition-activity" :class="`is-${tone}`" role="status" :title="message"><i aria-hidden="true" /><span>{{ message || '等待开始识别' }}</span></span>
    </div>
    <article v-if="primary" class="overlay-result">
      <p class="overlay-question">{{ primary.question }}</p>
      <div class="overlay-answer"><span>答案</span><strong>{{ primary.answerText }}</strong></div>
    </article>
    <section v-if="remaining.length" class="overlay-ranked-results">
      <div class="overlay-ranked-title">175dt还返回了以下题目，请按题干核对</div>
      <ol><li v-for="(candidate, index) in remaining" :key="`${candidate.question}-${candidate.answerText}`">
        <span class="overlay-rank">{{ index + 2 }}</span>
        <div><p>{{ candidate.question }}</p><strong>{{ candidate.answerText }}</strong></div>
      </li></ol>
    </section>
    <p v-if="!primary" class="overlay-waiting">{{ message || '等待识别题目' }}</p>
  </aside>
</template>
