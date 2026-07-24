<script setup lang="ts">
import { computed } from 'vue'
import type { CaptureFrame } from '../types/capture'

const props = defineProps<{
  frame: CaptureFrame | null
}>()

const hasFrame = computed(() => Boolean(props.frame))
</script>

<template>
  <section class="panel">
    <h2>截图预览</h2>
    <p v-if="!hasFrame" class="muted">暂无截图，请先授权屏幕捕获并截图。</p>
    <p v-else class="muted">已捕获：{{ new Date(frame!.capturedAt).toLocaleTimeString() }}</p>
  </section>
</template>
