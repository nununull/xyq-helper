import { defineStore } from 'pinia'
import type { CaptureFrame, CaptureStatus } from '../types/capture'

export const useCaptureStore = defineStore('capture', {
  state: () => ({
    status: 'idle' as CaptureStatus,
    error: '',
    lastFrame: null as CaptureFrame | null,
  }),
  actions: {
    setStatus(status: CaptureStatus) {
      this.status = status
    },
    setError(error: string) {
      this.status = 'error'
      this.error = error
    },
    setFrame(frame: CaptureFrame) {
      this.lastFrame = frame
    },
  },
})
