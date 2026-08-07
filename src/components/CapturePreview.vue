<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CaptureFrame } from '../types/capture'

const props = defineProps<{
  stream: MediaStream | null
  frame: CaptureFrame | null
}>()

const video = ref<HTMLVideoElement | null>(null)

/** 将仍在运行的共享流绑定到预览视频。 */
async function bindStream(): Promise<void> {
  await nextTick()
  if (!video.value) return
  if (video.value.srcObject !== props.stream) video.value.srcObject = props.stream
  if (props.stream) await video.value.play()
}

/** 在组件销毁前解除视频媒体引用。 */
function releaseVideo(): void {
  if (video.value) video.value.srcObject = null
}

watch(() => props.stream, () => void bindStream())
onMounted(() => void bindStream())
onBeforeUnmount(releaseVideo)
</script>

<template>
  <section class="panel capture-preview-panel">
    <div class="capture-preview-header">
      <h2>共享画面</h2>
      <span v-if="frame" class="muted">
        最近识别：{{ new Date(frame.capturedAt).toLocaleTimeString() }}
      </span>
    </div>
    <div v-if="stream" class="capture-preview-stage">
      <video ref="video" muted playsinline />
    </div>
    <p v-else class="muted">暂无共享画面，请先连接游戏窗口。</p>
  </section>
</template>
