<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import AnswerOverlay from './AnswerOverlay.vue'
import CapturePreview from './CapturePreview.vue'
import OCRResult from './OCRResult.vue'
import SettingsPanel from './SettingsPanel.vue'
import UnknownQuestions from './UnknownQuestions.vue'
import { useOCR } from '../composables/useOCR'
import { useScreenCapture } from '../composables/useScreenCapture'
import { activityCategories } from '../data/activityCategories'
import { useRecognitionController } from '../features/recognition/useRecognitionController'
import { useCaptureStore } from '../stores/capture'
import { useConfigStore } from '../stores/config'
import { useMatcherStore } from '../stores/matcher'
import { useOCRStore } from '../stores/ocr'
import { useRecognitionStore } from '../stores/recognition'

const captureStore = useCaptureStore()
const configStore = useConfigStore()
const ocrStore = useOCRStore()
const matcherStore = useMatcherStore()
const recognitionStore = useRecognitionStore()
const screenCapture = useScreenCapture()
const ocr = useOCR()
const controller = useRecognitionController()

const selectedCategoryId = computed(() => configStore.config.remoteQuery.categoryId)

/** 获取屏幕共享后启动连续识别。 */
async function startCapture(): Promise<void> {
  if (!selectedCategoryId.value) return

  try {
    captureStore.setStatus('requesting')
    await screenCapture.startCapture()
    captureStore.setStatus('active')
    controller.start()
  } catch (error) {
    controller.stop()
    screenCapture.stopCapture()
    captureStore.setError(error instanceof Error ? error.message : '屏幕捕获授权失败')
  }
}

/** 停止连续识别与当前屏幕共享。 */
function stopCapture(): void {
  controller.stop()
  screenCapture.stopCapture()
  captureStore.setStatus('paused')
}

/** 切换活动分类前停止并重置旧分类识别上下文。 */
async function selectCategory(categoryId: string): Promise<void> {
  if (categoryId === selectedCategoryId.value) return
  controller.stop()
  controller.resetForCategory()
  await configStore.selectActivityCategory(categoryId)
}

/** 处理用户从浏览器共享控件主动结束捕获。 */
function handleCaptureEnded(): void {
  controller.stop()
  captureStore.setStatus('paused')
}

/** 页面隐藏时立即暂停识别并中止在途请求。 */
function handleVisibilityChange(): void {
  if (document.hidden) controller.stop()
}

const unsubscribeCaptureEnded = screenCapture.onCaptureEnded(handleCaptureEnded)
document.addEventListener('visibilitychange', handleVisibilityChange)

onBeforeUnmount(() => {
  unsubscribeCaptureEnded()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  controller.stop()
  screenCapture.stopCapture()
  void ocr.terminateOCR()
})
</script>

<template>
  <section class="dashboard">
    <header class="topbar">
      <div>
        <h1>梦幻西游答题助手</h1>
        <p>纯前端识别，答案提示仅显示在浏览器窗口内。</p>
      </div>
      <div class="topbar-actions">
        <span class="status-pill">{{ captureStore.status }}</span>
        <button type="button" :disabled="!selectedCategoryId" @click="startCapture">开始连续识别</button>
        <button type="button" :disabled="!recognitionStore.running" @click="stopCapture">停止</button>
        <button type="button" :disabled="captureStore.status !== 'active'" @click="controller.retry">
          手动重试
        </button>
      </div>
    </header>

    <div class="dashboard-grid">
      <aside class="panel sidebar">
        <h2>活动分类</h2>
        <button
          v-for="category in activityCategories"
          :key="category.id"
          type="button"
          class="category-button"
          :class="{ active: selectedCategoryId === category.id }"
          @click="selectCategory(category.id)"
        >
          {{ category.name }}
        </button>
      </aside>

      <main class="workspace">
        <CapturePreview :frame="captureStore.lastFrame" />
        <OCRResult :result="ocrStore.lastResult" :parsed="null" />
        <section class="panel">
          <h2>匹配结果</h2>
          <p v-if="!matcherStore.result" class="muted">暂无可靠答案。</p>
          <template v-else>
            <div class="answer-row">
              <span
                v-for="key in ['A', 'B', 'C', 'D']"
                :key="key"
                class="answer-key"
                :class="{ active: matcherStore.result.answer === key }"
              >
                {{ key }}
              </span>
            </div>
            <p>{{ matcherStore.result.matchedQuestion }}</p>
          </template>
        </section>
        <AnswerOverlay :result="matcherStore.result" />
      </main>

      <aside class="rightbar">
        <section class="panel">
          <h2>状态</h2>
          <p>阶段：{{ recognitionStore.message }}</p>
          <p v-if="matcherStore.result?.resultSource">来源：{{ matcherStore.result.resultSource }}</p>
          <p v-if="matcherStore.result?.durationMs">总耗时：{{ matcherStore.result.durationMs }}ms</p>
          <p v-if="matcherStore.result?.warning" class="warning-text">{{ matcherStore.result.warning }}</p>
          <p v-if="matcherStore.error" class="error-text">{{ matcherStore.error }}</p>
        </section>
        <SettingsPanel />
        <UnknownQuestions />
      </aside>
    </div>
  </section>
</template>
