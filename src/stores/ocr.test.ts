import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { OCRResult } from '../types/ocr'
import { useOCRStore } from './ocr'

const result = {
  question: { text: '新题干', confidence: 0.9 },
  options: { text: 'A. 新选项', confidence: 0.8 },
  durationMs: 10,
} satisfies OCRResult

describe('OCR Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('失败后的下一次成功会清除旧错误', () => {
    const store = useOCRStore()
    store.setError('旧错误')

    store.setResult(result)
    store.setStatus('ready')

    expect(store.status).toBe('ready')
    expect(store.lastResult).toEqual(result)
    expect(store.error).toBe('')
  })
})
