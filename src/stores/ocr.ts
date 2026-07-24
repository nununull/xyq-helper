import { defineStore } from 'pinia'
import type { OCRResult, OCRStatus } from '../types/ocr'

export const useOCRStore = defineStore('ocr', {
  state: () => ({
    status: 'idle' as OCRStatus,
    error: '',
    lastResult: null as OCRResult | null,
  }),
  actions: {
    setStatus(status: OCRStatus) {
      this.status = status
    },
    setError(error: string) {
      this.status = 'error'
      this.error = error
    },
    setResult(result: OCRResult) {
      this.lastResult = result
    },
  },
})
