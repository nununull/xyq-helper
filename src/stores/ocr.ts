import { defineStore } from 'pinia'
import type { OCRResult, OCRStatus } from '../types/ocr'

export const useOCRStore = defineStore('ocr', {
  state: () => ({
    status: 'idle' as OCRStatus,
    error: '',
    lastResult: null as OCRResult | null,
  }),
  actions: {
    /** 设置 OCR 当前运行状态。 */
    setStatus(status: OCRStatus) {
      this.status = status
    },
    /** 记录 OCR 失败状态及错误消息。 */
    setError(error: string) {
      this.status = 'error'
      this.error = error
    },
    /** 发布最新 OCR 结果并清除上一次失败消息。 */
    setResult(result: OCRResult) {
      this.lastResult = result
      this.error = ''
    },
  },
})
