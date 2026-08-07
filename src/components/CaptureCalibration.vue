<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  convertPreviewRegionToVideoPixels,
  convertVideoRegionToPreviewPixels,
} from '../features/setup/previewCoordinates'
import type { CaptureRegion } from '../types/capture'

const props = defineProps<{
  stream: MediaStream
  initialQuestionRegion: CaptureRegion | null
  initialOptionsRegion: CaptureRegion | null
}>()

const emit = defineEmits<{
  completed: [questionRegion: CaptureRegion, optionsRegion: CaptureRegion]
  cancel: []
}>()

const video = ref<HTMLVideoElement | null>(null)
const stage = ref<HTMLElement | null>(null)
const step = ref<'question' | 'options'>('question')
const selecting = ref(false)
const startPoint = ref({ x: 0, y: 0 })
const draftRegion = ref<CaptureRegion | null>(null)
const questionRegion = ref<CaptureRegion | null>(cloneRegion(props.initialQuestionRegion))
const optionsRegion = ref<CaptureRegion | null>(cloneRegion(props.initialOptionsRegion))
const previewSize = ref({ width: 0, height: 0 })
const videoSize = ref({ width: 0, height: 0 })
let resizeObserver: ResizeObserver | null = null

const stepMessage = computed(() => step.value === 'question'
  ? '在共享画面内拖动框选题干，绿色框会保留在画面中'
  : '继续框选 A、B、C、D 选项，完成后点击“确认校准”')
const questionPreviewRegion = computed(() => toPreviewRegion(questionRegion.value))
const optionsPreviewRegion = computed(() => toPreviewRegion(optionsRegion.value))
const canConfirm = computed(() => questionRegion.value !== null && optionsRegion.value !== null)

/** 复制区域数据，避免校准过程直接修改持久化配置。 */
function cloneRegion(region: CaptureRegion | null): CaptureRegion | null {
  return region ? { ...region } : null
}

/** 将视频像素区域换算为当前预览框中的展示区域。 */
function toPreviewRegion(region: CaptureRegion | null): CaptureRegion | null {
  if (
    !region
    || previewSize.value.width <= 0
    || previewSize.value.height <= 0
    || videoSize.value.width <= 0
    || videoSize.value.height <= 0
  ) return null
  return convertVideoRegionToPreviewPixels(region, videoSize.value, previewSize.value)
}

/** 同步共享视频与预览容器尺寸，保证选框始终贴合画面。 */
function syncStageSize(): void {
  const bounds = stage.value?.getBoundingClientRect()
  const source = video.value
  if (bounds) previewSize.value = { width: bounds.width, height: bounds.height }
  if (source?.videoWidth && source.videoHeight) {
    videoSize.value = { width: source.videoWidth, height: source.videoHeight }
  }
}

/** 将当前共享流绑定到预览视频。 */
async function bindStream(): Promise<void> {
  await nextTick()
  if (!video.value) return
  video.value.srcObject = props.stream
  await video.value.play()
  syncStageSize()
}

/** 读取指针在预览画面内的局部坐标。 */
function readLocalPoint(event: PointerEvent): { x: number; y: number } | null {
  if (!stage.value) return null
  const bounds = stage.value.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
    y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
  }
}

/** 开始一次区域框选并捕获后续指针事件。 */
function startSelection(event: PointerEvent): void {
  const point = readLocalPoint(event)
  if (!point) return
  selecting.value = true
  startPoint.value = point
  draftRegion.value = { ...point, width: 0, height: 0 }
  stage.value?.setPointerCapture(event.pointerId)
}

/** 根据当前指针位置更新框选矩形。 */
function moveSelection(event: PointerEvent): void {
  if (!selecting.value) return
  const point = readLocalPoint(event)
  if (!point) return
  draftRegion.value = {
    x: Math.min(startPoint.value.x, point.x),
    y: Math.min(startPoint.value.y, point.y),
    width: Math.abs(point.x - startPoint.value.x),
    height: Math.abs(point.y - startPoint.value.y),
  }
}

/** 完成当前框选，并把结果保留在共享画面上等待用户确认。 */
function finishSelection(event: PointerEvent): void {
  if (!selecting.value) return
  moveSelection(event)
  selecting.value = false
  const region = draftRegion.value
  const preview = stage.value?.getBoundingClientRect()
  const source = video.value
  if (!region || !preview || !source || region.width < 8 || region.height < 8) return

  const videoRegion = convertPreviewRegionToVideoPixels(
    region,
    { width: preview.width, height: preview.height },
    { width: source.videoWidth, height: source.videoHeight },
  )
  if (step.value === 'question') {
    questionRegion.value = videoRegion
    draftRegion.value = null
    step.value = 'options'
    return
  }
  optionsRegion.value = videoRegion
  draftRegion.value = null
}

/** 切换要重新框选的区域，并清除该区域的旧框。 */
function selectRegion(type: 'question' | 'options'): void {
  step.value = type
  draftRegion.value = null
  if (type === 'question') questionRegion.value = null
  else optionsRegion.value = null
}

/** 确认并提交当前画面中展示的题干与选项区域。 */
function confirmCalibration(): void {
  if (!questionRegion.value || !optionsRegion.value) return
  emit('completed', questionRegion.value, optionsRegion.value)
}

/** 生成选框的定位样式。 */
function regionStyle(region: CaptureRegion): Record<string, string> {
  return {
    left: `${region.x}px`,
    top: `${region.y}px`,
    width: `${region.width}px`,
    height: `${region.height}px`,
  }
}

watch(() => props.stream, () => void bindStream())
onMounted(() => {
  resizeObserver = new ResizeObserver(syncStageSize)
  if (stage.value) resizeObserver.observe(stage.value)
  void bindStream()
})

onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<template>
  <section class="panel calibration-panel">
    <div class="calibration-header">
      <div>
        <h2>校准识别区域</h2>
        <p>{{ stepMessage }}</p>
      </div>
      <div class="calibration-legend" aria-label="选框图例">
        <span><i class="question-color" />题干</span>
        <span><i class="options-color" />选项</span>
      </div>
    </div>
    <div
      ref="stage"
      class="calibration-stage"
      @pointerdown="startSelection"
      @pointermove="moveSelection"
      @pointerup="finishSelection"
    >
      <video ref="video" muted playsinline @loadedmetadata="syncStageSize" />
      <div
        v-if="questionPreviewRegion"
        class="calibration-selection saved question-selection"
        :class="{ active: step === 'question' }"
        :style="regionStyle(questionPreviewRegion)"
      >
        <span>题干</span>
      </div>
      <div
        v-if="optionsPreviewRegion"
        class="calibration-selection saved options-selection"
        :class="{ active: step === 'options' }"
        :style="regionStyle(optionsPreviewRegion)"
      >
        <span>选项</span>
      </div>
      <div
        v-if="draftRegion"
        class="calibration-selection draft"
        :class="step === 'question' ? 'question-selection' : 'options-selection'"
        :style="regionStyle(draftRegion)"
      />
    </div>
    <div class="calibration-actions">
      <div>
        <button type="button" @click="selectRegion('question')">重选题干</button>
        <button type="button" @click="selectRegion('options')">重选选项</button>
      </div>
      <div>
        <button type="button" @click="emit('cancel')">取消校准</button>
        <button class="primary-action" type="button" :disabled="!canConfirm" @click="confirmCalibration">
          确认校准
        </button>
      </div>
    </div>
  </section>
</template>
