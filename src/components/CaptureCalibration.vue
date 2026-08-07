<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { convertPreviewRegionToVideoPixels } from '../features/setup/previewCoordinates'
import type { CaptureRegion } from '../types/capture'

const props = defineProps<{
  stream: MediaStream
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
const questionRegion = ref<CaptureRegion | null>(null)

const stepMessage = computed(() => step.value === 'question'
  ? '在共享画面中拖动框选题干区域'
  : '继续拖动框选 A、B、C、D 选项区域')

/** 将当前共享流绑定到预览视频。 */
async function bindStream(): Promise<void> {
  await nextTick()
  if (!video.value) return
  video.value.srcObject = props.stream
  await video.value.play()
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

/** 完成当前框选；两个区域齐备后输出视频像素坐标。 */
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
  if (questionRegion.value) emit('completed', questionRegion.value, videoRegion)
}

watch(() => props.stream, () => void bindStream())
onMounted(() => void bindStream())
</script>

<template>
  <section class="panel calibration-panel">
    <div class="calibration-header">
      <div>
        <h2>校准识别区域</h2>
        <p>{{ stepMessage }}</p>
      </div>
      <button type="button" @click="emit('cancel')">取消校准</button>
    </div>
    <div
      ref="stage"
      class="calibration-stage"
      @pointerdown="startSelection"
      @pointermove="moveSelection"
      @pointerup="finishSelection"
    >
      <video ref="video" muted playsinline />
      <div
        v-if="draftRegion"
        class="calibration-selection"
        :style="{
          left: `${draftRegion.x}px`,
          top: `${draftRegion.y}px`,
          width: `${draftRegion.width}px`,
          height: `${draftRegion.height}px`,
        }"
      />
    </div>
  </section>
</template>
