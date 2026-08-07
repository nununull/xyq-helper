<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CaptureFrame, CaptureRegion } from '../types/capture'

const props = defineProps<{
  stream: MediaStream | null
  frame: CaptureFrame | null
  questionRegion: CaptureRegion | null
  focusMode: boolean
}>()

const video = ref<HTMLVideoElement | null>(null)
const videoSize = ref({ width: 0, height: 0 })

const dockSide = computed<'left' | 'right'>(() => {
  const region = props.questionRegion
  const source = videoSize.value
  if (!region || !source.width) return 'right'
  return region.x + region.width / 2 < source.width / 2 ? 'left' : 'right'
})

/** 同步视频原始尺寸，判断答案栏应贴近画面的哪一侧。 */
function syncVideoSize(): void {
  const source = video.value
  if (source?.videoWidth && source.videoHeight) {
    videoSize.value = { width: source.videoWidth, height: source.videoHeight }
  }
}

/** 将仍在运行的共享流绑定到预览视频。 */
async function bindStream(): Promise<void> {
  await nextTick()
  if (!video.value) return
  if (video.value.srcObject !== props.stream) video.value.srcObject = props.stream
  if (props.stream) {
    await video.value.play()
    syncVideoSize()
  }
}

/** 在组件销毁前解除视频媒体引用。 */
function releaseVideo(): void {
  if (video.value) video.value.srcObject = null
}

watch(() => props.stream, () => void bindStream())
onMounted(() => {
  void bindStream()
})
onBeforeUnmount(() => {
  releaseVideo()
})
</script>

<template>
  <section class="panel capture-preview-panel" :class="{ 'is-focus-mode': focusMode }">
    <div class="capture-preview-header">
      <h2>共享画面</h2>
      <span v-if="frame" class="muted">
        最近识别：{{ new Date(frame.capturedAt).toLocaleTimeString() }}
      </span>
    </div>
    <div v-if="stream" class="capture-preview-stage" :class="`answer-dock-${dockSide}`">
      <div class="capture-preview-video">
        <video ref="video" muted playsinline @loadedmetadata="syncVideoSize" />
      </div>
      <div class="capture-preview-overlay">
        <slot />
      </div>
    </div>
    <p v-else class="muted">暂无共享画面，请先连接游戏窗口。</p>
  </section>
</template>
