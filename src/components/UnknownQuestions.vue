<script setup lang="ts">
import { onMounted } from 'vue'
import { useDBStore } from '../stores/db'

const dbStore = useDBStore()

onMounted(() => {
  void dbStore.refreshUnknownQuestions()
})
</script>

<template>
  <section class="panel">
    <h2>未知题目 {{ dbStore.unknownQuestions.length }}</h2>
    <p v-if="dbStore.unknownQuestions.length === 0" class="muted">暂无未知题目。</p>
    <article v-for="question in dbStore.unknownQuestions" :key="question.id" class="unknown-item">
      <strong>{{ question.question }}</strong>
      <p class="muted">OCR 置信度 {{ Math.round(question.ocrConfidence * 100) }}%</p>
    </article>
  </section>
</template>
