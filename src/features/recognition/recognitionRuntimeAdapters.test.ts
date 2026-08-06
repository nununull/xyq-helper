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

/** 创建可观测调用的 OCR Store 端口。 */
function createOCRStorePort() {
  return {
    setStatus: vi.fn(),
    setResult: vi.fn(),
    setError: vi.fn(),
  }
}

describe('生产识别运行时适配器', () => {
  it('捕获成功时同步预览 Store', () => {
    const captureStore = { setFrame: vi.fn() }
    const adapters = createRecognitionRuntimeAdapters({
      captureFrame: () => frame,
      captureStore,
      ocrStore: createOCRStorePort(),
    })

    expect(adapters.captureFrame()).toBe(frame)
    expect(captureStore.setFrame).toHaveBeenCalledWith(frame)
  })

  it('OCR 发布操作与引擎调用分离并同步对应 Store 状态', () => {
    const ocrStore = createOCRStorePort()
    const adapters = createRecognitionRuntimeAdapters({
      captureFrame: () => null,
      captureStore: { setFrame: vi.fn() },
      ocrStore,
    })

    adapters.publishOCRStarted()
    adapters.publishOCRResult(result)
    adapters.publishOCRError('OCR 失败')

    expect(ocrStore.setStatus).toHaveBeenNthCalledWith(1, 'recognizing')
    expect(ocrStore.setResult).toHaveBeenCalledWith(result)
    expect(ocrStore.setStatus).toHaveBeenNthCalledWith(2, 'ready')
    expect(ocrStore.setError).toHaveBeenCalledWith('OCR 失败')
  })
})
