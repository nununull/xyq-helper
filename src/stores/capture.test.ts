import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { getCaptureErrorMessage, useCaptureStore } from './capture'

describe('屏幕捕获状态', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('屏幕共享被拒绝时映射为固定中文提示', () => {
    const error = new DOMException('Permission denied', 'NotAllowedError')

    expect(getCaptureErrorMessage(error)).toBe('屏幕共享已被拒绝，请允许共享后重试')
  })

  it('不同浏览器以普通 Error 抛出拒绝名称时仍使用固定提示', () => {
    const error = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })

    expect(getCaptureErrorMessage(error)).toBe('屏幕共享已被拒绝，请允许共享后重试')
  })

  it('重新开始或成功授权时清除旧捕获错误', () => {
    const store = useCaptureStore()

    store.setError('屏幕共享已被拒绝，请允许共享后重试')
    store.setStatus('requesting')
    expect(store.error).toBe('')

    store.setError('旧错误')
    store.setStatus('active')
    expect(store.error).toBe('')
  })
})
