import { describe, expect, it, vi } from 'vitest'
import type { CaptureFrame } from '../../types/capture'
import type { OCRResult } from '../../types/ocr'
import { createRecognitionRuntimeAdapters } from './recognitionRuntimeAdapters'

const frame = { frameHash: 'frame' } as CaptureFrame
const result = {
  question: { text: '题干', confidence: 0.9 },
  options: { text: 'A. 选项', confidence: 0.8 },
  durationMs: 10,
} satisfies OCRResult

describe('生产识别运行时适配器', () => {
  it('捕获和 OCR 成功时同步预览及 OCR Store', async () => {
    const captureStore = { setFrame: vi.fn() }
    const ocrStore = {
      setStatus: vi.fn(),
      setResult: vi.fn(),
      setError: vi.fn(),
    }
    const adapters = createRecognitionRuntimeAdapters({
      captureFrame: () => frame,
      recognizeFrame: async () => result,
      captureStore,
      ocrStore,
    })

    expect(adapters.captureFrame()).toBe(frame)
    await expect(adapters.recognizeFrame(frame)).resolves.toBe(result)

    expect(captureStore.setFrame).toHaveBeenCalledWith(frame)
    expect(ocrStore.setStatus).toHaveBeenNthCalledWith(1, 'recognizing')
    expect(ocrStore.setResult).toHaveBeenCalledWith(result)
    expect(ocrStore.setStatus).toHaveBeenNthCalledWith(2, 'ready')
    expect(ocrStore.setError).not.toHaveBeenCalled()
  })

  it('OCR 失败时同步错误并继续向控制器抛出', async () => {
    const error = new Error('OCR 失败')
    const ocrStore = {
      setStatus: vi.fn(),
      setResult: vi.fn(),
      setError: vi.fn(),
    }
    const adapters = createRecognitionRuntimeAdapters({
      captureFrame: () => null,
      recognizeFrame: async () => { throw error },
      captureStore: { setFrame: vi.fn() },
      ocrStore,
    })

    await expect(adapters.recognizeFrame(frame)).rejects.toBe(error)

    expect(ocrStore.setStatus).toHaveBeenCalledWith('recognizing')
    expect(ocrStore.setError).toHaveBeenCalledWith('OCR 失败')
    expect(ocrStore.setResult).not.toHaveBeenCalled()
  })
})
