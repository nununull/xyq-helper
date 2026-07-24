<script setup lang="ts">
import { useAreaSelector } from '../composables/useAreaSelector'
import type { CaptureRegion } from '../types/capture'

const emit = defineEmits<{
  selected: [region: CaptureRegion]
  cancel: []
}>()

const selector = useAreaSelector()

function onMouseDown(event: MouseEvent) {
  selector.start(event.clientX, event.clientY)
}

function onMouseMove(event: MouseEvent) {
  selector.move(event.clientX, event.clientY)
}

function onMouseUp() {
  const region = selector.finish()
  if (region) {
    emit('selected', region)
  }
}
</script>

<template>
  <div class="area-selector" @mousedown="onMouseDown" @mousemove="onMouseMove" @mouseup="onMouseUp">
    <button class="selector-cancel" type="button" @click.stop="emit('cancel')">取消框选</button>
    <div
      v-if="selector.region.value"
      class="selector-box"
      :style="{
        left: `${selector.region.value.x}px`,
        top: `${selector.region.value.y}px`,
        width: `${selector.region.value.width}px`,
        height: `${selector.region.value.height}px`,
      }"
    >
      <span>{{ Math.round(selector.region.value.width) }} × {{ Math.round(selector.region.value.height) }}</span>
    </div>
  </div>
</template>
