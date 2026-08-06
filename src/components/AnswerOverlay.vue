<script setup lang="ts">
import type { MatchResult } from '../types/match'

defineProps<{
  result: MatchResult | null
}>()
</script>

<template>
  <div v-if="result" class="answer-overlay">
    <strong v-if="result.answer">答案：{{ result.answer }}</strong>
    <strong v-else>答案：{{ result.answerText }}</strong>
    <span>置信度 {{ Math.round(result.confidence * 100) }}%</span>
  </div>
</template>
