<script setup lang="ts">
import type { MatchResult } from '../types/match'

defineProps<{
  result: MatchResult | null
}>()
</script>

<template>
  <div v-if="result" class="answer-overlay">
    <strong>答案：{{ result.answer }}</strong>
    <span>置信度 {{ Math.round(result.confidence * 100) }}%</span>
  </div>
</template>
