<script setup lang="ts">
import { computed, ref } from 'vue'
import AnswerOverlay from './AnswerOverlay.vue'
import CapturePreview from './CapturePreview.vue'
import OCRResult from './OCRResult.vue'
import SettingsPanel from './SettingsPanel.vue'
import UnknownQuestions from './UnknownQuestions.vue'
import { useOCR } from '../composables/useOCR'
import { useScreenCapture } from '../composables/useScreenCapture'
import { useCaptureStore } from '../stores/capture'
import { useConfigStore } from '../stores/config'
import { useDBStore } from '../stores/db'
import { useMatcherStore } from '../stores/matcher'
import { useOCRStore } from '../stores/ocr'
import type { ParsedQuestion } from '../types/question'
import { matchQuestion } from '../utils/matcher'
import { parseQuestion } from '../utils/parseQuestion'

const captureStore = useCaptureStore()
const configStore = useConfigStore()
const ocrStore = useOCRStore()
const matcherStore = useMatcherStore()
const dbStore = useDBStore()
const screenCapture = useScreenCapture()
const ocr = useOCR()
const parsedQuestion = ref<ParsedQuestion | null>(null)
const busy = ref(false)

const canCaptureFrame = computed(() => captureStore.status === 'active')

async function startCapture() {
  try {
    captureStore.setStatus('requesting')
    await screenCapture.startCapture()
    captureStore.setStatus('active')
  } catch (error) {
    captureStore.setError(error instanceof Error ? error.message : '屏幕捕获授权失败')
  }
}

function stopCapture() {
  screenCapture.stopCapture()
  captureStore.setStatus('paused')
}

async function recognizeOnce() {
  if (busy.value) {
    return
  }

  busy.value = true
  try {
    const frame = screenCapture.captureCurrentFrame(configStore.config.capture)
    if (!frame) {
      throw new Error('尚未捕获画面，或题干/选项区域未配置')
    }

    captureStore.setFrame(frame)
    ocrStore.setStatus('recognizing')
    const result = await ocr.recognizeFrame(frame)
    ocrStore.setResult(result)
    ocrStore.setStatus('ready')

    parsedQuestion.value = parseQuestion(result)
    const match = matchQuestion(
      parsedQuestion.value,
      undefined,
      configStore.config.matcher.minConfidence,
    )

    matcherStore.setResult(match)
    if (!match) {
      await dbStore.addUnknownQuestion({
        question: parsedQuestion.value.questionText || parsedQuestion.value.rawText,
        options: parsedQuestion.value.options,
        ocrConfidence: (result.question.confidence + result.options.confidence) / 2,
        screenshotHash: frame.frameHash,
        createdAt: new Date().toISOString(),
        status: 'pending',
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '识别失败'
    ocrStore.setError(message)
    matcherStore.setError(message)
  } finally {
    busy.value = false
  }
}
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
        <button type="button" @click="startCapture">开始捕获</button>
        <button type="button" @click="stopCapture">停止</button>
        <button type="button" :disabled="!canCaptureFrame || busy" @click="recognizeOnce">
          {{ busy ? '识别中...' : '截图识别' }}
        </button>
      </div>
    </header>

    <div class="dashboard-grid">
      <aside class="panel sidebar">
        <h2>活动分类</h2>
        <button type="button">全部</button>
        <button type="button">科举</button>
        <button type="button">三界书院</button>
        <button type="button">元宵灯谜</button>
      </aside>

      <main class="workspace">
        <CapturePreview :frame="captureStore.lastFrame" />
        <OCRResult :result="ocrStore.lastResult" :parsed="parsedQuestion" />
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
          <p>OCR：{{ ocrStore.status }}</p>
          <p>题库：{{ dbStore.version }} / {{ dbStore.questionCount }} 题</p>
          <p v-if="matcherStore.result">置信度：{{ Math.round(matcherStore.result.confidence * 100) }}%</p>
          <p v-if="ocrStore.error" class="error-text">{{ ocrStore.error }}</p>
        </section>
        <SettingsPanel />
        <UnknownQuestions />
      </aside>
    </div>
  </section>
</template>
