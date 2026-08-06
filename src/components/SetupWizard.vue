<script setup lang="ts">
import { ref } from 'vue'
import AreaSelector from './AreaSelector.vue'
import type { CaptureRegion } from '../types/capture'
import { applyCaptureRegion, type CaptureRegionKind } from '../features/setup/applyCaptureRegion'
import { useConfigStore } from '../stores/config'

const configStore = useConfigStore()
const step = ref<'intro' | 'question' | 'options'>('intro')

/** 将当前框选区域转换为普通对象并按步骤持久化。 */
async function saveRegion(kind: CaptureRegionKind, region: CaptureRegion) {
  const config = applyCaptureRegion(
    configStore.config,
    kind,
    region,
    window.devicePixelRatio || 1,
  )
  await configStore.update(config)
  if (kind === 'question') step.value = 'options'
}
</script>

<template>
  <section class="setup-panel">
    <div class="setup-card">
      <h1>梦幻西游答题助手</h1>
      <p>首次使用需要框选浏览器捕获画面中的题干区域和选项区域。答案只显示在本浏览器窗口内。</p>
      <div class="steps">
        <span :class="{ active: step === 'intro' }">1 准备</span>
        <span :class="{ active: step === 'question' }">2 题干</span>
        <span :class="{ active: step === 'options' }">3 选项</span>
      </div>
      <button v-if="step === 'intro'" type="button" @click="step = 'question'">开始框选题干</button>
      <button v-if="step === 'question'" type="button" @click="step = 'intro'">返回</button>
    </div>
    <AreaSelector
      v-if="step === 'question'"
      @selected="(region) => saveRegion('question', region)"
      @cancel="step = 'intro'"
    />
    <AreaSelector
      v-if="step === 'options'"
      @selected="(region) => saveRegion('options', region)"
      @cancel="step = 'intro'"
    />
  </section>
</template>
