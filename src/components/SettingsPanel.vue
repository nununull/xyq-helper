<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  clearAllRemoteQuestionCache,
  clearRemoteQuestionCacheByCategory,
} from '../composables/useLocalStorageDB'
import { useConfigStore } from '../stores/config'

const configStore = useConfigStore()
const cacheMessage = ref('')
const cacheError = ref('')
const selectedCategoryId = computed(() => configStore.config.remoteQuery.categoryId)

/** 清理当前选中活动分类的远程答案缓存。 */
async function clearSelectedCategoryCache(): Promise<void> {
  cacheMessage.value = ''
  cacheError.value = ''
  if (!selectedCategoryId.value) {
    cacheError.value = '请先选择活动分类'
    return
  }

  try {
    await clearRemoteQuestionCacheByCategory(selectedCategoryId.value)
    cacheMessage.value = '当前分类缓存已清理'
  } catch (error) {
    cacheError.value = error instanceof Error ? error.message : '当前分类缓存清理失败'
  }
}

/** 清理全部活动分类的远程答案缓存。 */
async function clearRemoteCache(): Promise<void> {
  cacheMessage.value = ''
  cacheError.value = ''
  try {
    await clearAllRemoteQuestionCache()
    cacheMessage.value = '全部远程缓存已清理'
  } catch (error) {
    cacheError.value = error instanceof Error ? error.message : '远程缓存清理失败'
  }
}
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
    <div class="cache-actions">
      <button type="button" :disabled="!selectedCategoryId" @click="clearSelectedCategoryCache">
        清理当前分类缓存
      </button>
      <button type="button" @click="clearRemoteCache">清理全部远程缓存</button>
    </div>
    <p v-if="cacheMessage" class="success-text">{{ cacheMessage }}</p>
    <p v-if="cacheError" class="error-text">{{ cacheError }}</p>
  </section>
</template>
