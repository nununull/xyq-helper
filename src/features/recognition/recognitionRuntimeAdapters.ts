import type { CaptureFrame } from '../../types/capture'
import type { OCRResult, OCRStatus } from '../../types/ocr'

interface CaptureStorePort {
  /** 发布最新捕获帧供界面预览。 */
  setFrame(frame: CaptureFrame): void
}

interface OCRStorePort {
  /** 更新 OCR 的运行状态。 */
  setStatus(status: OCRStatus): void
  /** 发布最新 OCR 结果。 */
  setResult(result: OCRResult): void
  /** 发布 OCR 错误。 */
  setError(error: string): void
}

export interface RecognitionRuntimeAdapterDependencies {
  /** 从当前屏幕共享中捕获一帧。 */
  captureFrame(): CaptureFrame | null
  /** 识别指定捕获帧。 */
  recognizeFrame(frame: CaptureFrame): Promise<OCRResult>
  captureStore: CaptureStorePort
  ocrStore: OCRStorePort
}

/** 创建同步界面展示 Store 的生产识别依赖适配器。 */
export function createRecognitionRuntimeAdapters(
  dependencies: RecognitionRuntimeAdapterDependencies,
) {
  /** 捕获画面并在成功时同步预览 Store。 */
  function captureFrame(): CaptureFrame | null {
    const frame = dependencies.captureFrame()
    if (frame) dependencies.captureStore.setFrame(frame)
    return frame
  }

  /** 执行 OCR，并同步识别中、成功或失败状态。 */
  async function recognizeFrame(frame: CaptureFrame): Promise<OCRResult> {
    dependencies.ocrStore.setStatus('recognizing')
    try {
      const result = await dependencies.recognizeFrame(frame)
      dependencies.ocrStore.setResult(result)
      dependencies.ocrStore.setStatus('ready')
      return result
    } catch (error) {
      dependencies.ocrStore.setError(error instanceof Error ? error.message : 'OCR 识别失败')
      throw error
    }
  }

  return { captureFrame, recognizeFrame }
}
