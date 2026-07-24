<script setup lang="ts">
import type { OCRResult } from '../types/ocr'
import type { ParsedQuestion } from '../types/question'

defineProps<{
  result: OCRResult | null
  parsed: ParsedQuestion | null
}>()
</script>

<template>
  <section class="panel">
    <h2>OCR 结果</h2>
    <p v-if="!result" class="muted">暂无识别结果</p>
    <template v-else>
      <div class="ocr-grid">
        <div>
          <h3>题干</h3>
          <pre>{{ result.question.text }}</pre>
        </div>
        <div>
          <h3>选项</h3>
          <pre>{{ result.options.text }}</pre>
        </div>
      </div>
      <p class="muted">耗时 {{ result.durationMs }}ms</p>
      <div v-if="parsed" class="parsed-box">
        <h3>结构化结果</h3>
        <p>{{ parsed.questionText }}</p>
        <p v-for="(text, key) in parsed.options" :key="key">{{ key }}. {{ text }}</p>
      </div>
    </template>
  </section>
</template>
