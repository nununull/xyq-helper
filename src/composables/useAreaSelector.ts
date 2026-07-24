import { ref } from 'vue'
import type { CaptureRegion } from '../types/capture'

export function useAreaSelector() {
  const selecting = ref(false)
  const region = ref<CaptureRegion | null>(null)
  const startPoint = ref({ x: 0, y: 0 })

  function start(x: number, y: number) {
    selecting.value = true
    startPoint.value = { x, y }
    region.value = { x, y, width: 0, height: 0 }
  }

  function move(x: number, y: number) {
    if (!selecting.value) {
      return
    }

    region.value = {
      x: Math.min(startPoint.value.x, x),
      y: Math.min(startPoint.value.y, y),
      width: Math.abs(x - startPoint.value.x),
      height: Math.abs(y - startPoint.value.y),
    }
  }

  function finish(): CaptureRegion | null {
    selecting.value = false
    return region.value && region.value.width > 8 && region.value.height > 8 ? region.value : null
  }

  return {
    selecting,
    region,
    start,
    move,
    finish,
  }
}
