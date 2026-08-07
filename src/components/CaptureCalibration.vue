<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  convertPreviewRegionToVideoPixels,
  convertVideoRegionToPreviewPixels,
} from '../features/setup/previewCoordinates'
import type { CaptureRegion } from '../types/capture'

const props = defineProps<{
  stream: MediaStream
  initialAnswerRegion: CaptureRegion | null
}>()

const emit = defineEmits<{
  completed: [answerRegion: CaptureRegion]
  cancel: []
}>()

const video = ref<HTMLVideoElement | null>(null)
const stage = ref<HTMLElement | null>(null)
const selecting = ref(false)
const startPoint = ref({ x: 0, y: 0 })
const draftRegion = ref<CaptureRegion | null>(null)
const answerRegion = ref<CaptureRegion | null>(
  props.initialAnswerRegion ? { ...props.initialAnswerRegion } : null,
)
const previewSize = ref({ width: 0, height: 0 })
const videoSize = ref({ width: 0, height: 0 })
let resizeObserver: ResizeObserver | null = null

const answerPreviewRegion = computed(() => toPreviewRegion(answerRegion.value))
const visibleRegion = computed(() => draftRegion.value ?? answerPreviewRegion.value)

/** 将视频像素区域换算为当前预览中的展示区域。 */
function toPreviewRegion(region: CaptureRegion | null): CaptureRegion | null {
  if (!region || !previewSize.value.width || !videoSize.value.width) return null
  return convertVideoRegionToPreviewPixels(region, videoSize.value, previewSize.value)
}

/** 同步共享视频与预览容器尺寸。 */
function syncStageSize(): void {
  const bounds = stage.value?.getBoundingClientRect()
  const source = video.value
  if (bounds) previewSize.value = { width: bounds.width, height: bounds.height }
  if (source?.videoWidth && source.videoHeight) {
    videoSize.value = { width: source.videoWidth, height: source.videoHeight }
  }
}

/** 将共享流绑定到校准视频。 */
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

/** 开始框选完整答题窗口。 */
function startSelection(event: PointerEvent): void {
  const point = readLocalPoint(event)
  if (!point) return
  selecting.value = true
  startPoint.value = point
  draftRegion.value = { ...point, width: 0, height: 0 }
  stage.value?.setPointerCapture(event.pointerId)
}

/** 根据指针位置更新当前选框。 */
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

/** 完成选框并转换成视频原始像素坐标。 */
function finishSelection(event: PointerEvent): void {
  if (!selecting.value) return
  moveSelection(event)
  selecting.value = false
  const region = draftRegion.value
  const preview = stage.value?.getBoundingClientRect()
  const source = video.value
  if (!region || !preview || !source || region.width < 8 || region.height < 8) return
  answerRegion.value = convertPreviewRegionToVideoPixels(
    region,
    { width: preview.width, height: preview.height },
    { width: source.videoWidth, height: source.videoHeight },
  )
  draftRegion.value = null
}

/** 确认并提交完整答题区域。 */
function confirmCalibration(): void {
  if (answerRegion.value) emit('completed', answerRegion.value)
}

/** 清空旧区域并等待重新框选。 */
function resetSelection(): void {
  answerRegion.value = null
  draftRegion.value = null
}

/** 生成选框定位样式。 */
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
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (video.value) video.value.srcObject = null
})
</script>

<template>
  <section class="panel calibration-panel">
    <div class="calibration-header">
      <div>
        <h2>校准答题区域</h2>
        <p>拖动框选包含题干和全部选项的完整答题窗口，只需框选一次。</p>
      </div>
      <div class="calibration-legend" aria-label="选框图例">
        <span><i class="answer-color" />完整答题区域</span>
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
        v-if="visibleRegion"
        class="calibration-selection answer-selection active"
        :style="regionStyle(visibleRegion)"
      >
        <span v-if="!draftRegion">答题区域</span>
      </div>
    </div>
    <div class="calibration-actions">
      <div>
        <button type="button" @click="resetSelection">重新框选</button>
      </div>
      <div>
        <button type="button" @click="emit('cancel')">取消校准</button>
        <button class="primary-action" type="button" :disabled="!answerRegion" @click="confirmCalibration">
          确认校准
        </button>
      </div>
    </div>
  </section>
</template>
