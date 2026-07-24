<script setup lang="ts">
import { useConfigStore } from '../stores/config'

const configStore = useConfigStore()
</script>

<template>
  <section class="panel settings-panel">
    <h2>设置</h2>
    <label>
      抽帧频率
      <input v-model.number="configStore.config.capture.captureFps" min="1" max="5" type="number" />
    </label>
    <label>
      OCR 阈值
      <input v-model.number="configStore.config.ocr.threshold" min="0" max="255" type="number" />
    </label>
    <label>
      最小置信度
      <input v-model.number="configStore.config.matcher.minConfidence" min="0" max="1" step="0.05" type="number" />
    </label>
  </section>
</template>
