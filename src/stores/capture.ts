import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import type { CaptureFrame, CaptureStatus } from '../types/capture'

/** 将屏幕捕获异常转换为稳定的中文提示。 */
export function getCaptureErrorMessage(error: unknown): string {
  const errorName = error && typeof error === 'object' && 'name' in error
    ? String(error.name)
    : ''
  const errorMessage = error instanceof Error ? error.message : ''
  if (errorName === 'NotAllowedError') {
    return '屏幕共享已被拒绝，请允许共享后重试'
  }
  if (errorName === 'NotFoundError') {
    return '未找到可共享的屏幕或窗口'
  }
  if (
    errorName === 'NotReadableError'
    || /could not start video source/i.test(errorMessage)
  ) {
    return '无法读取所选画面，请恢复目标窗口、关闭其他录屏软件后重新连接'
  }
  if (errorName === 'AbortError') {
    return '已取消选择共享画面'
  }
  return errorMessage
    ? errorMessage
    : '屏幕捕获授权失败'
}

export const useCaptureStore = defineStore('capture', {
  state: () => ({
    status: 'idle' as CaptureStatus,
    error: '',
    lastFrame: null as CaptureFrame | null,
  }),
  actions: {
    /** 更新捕获状态，并在重新请求或成功后清除旧错误。 */
    setStatus(status: CaptureStatus) {
      this.status = status
      if (status === 'requesting' || status === 'active') this.error = ''
    },
    /** 记录捕获失败状态及展示文案。 */
    setError(error: string) {
      this.status = 'error'
      this.error = error
    },
    /** 记录最新的捕获帧。 */
    setFrame(frame: CaptureFrame) {
      // ImageData 体积较大且不需要响应式代理，只保留帧对象本身的替换通知。
      this.lastFrame = markRaw(frame)
    },
  },
})
