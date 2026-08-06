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

  /** 发布 OCR 已开始状态。 */
  function publishOCRStarted(): void {
    dependencies.ocrStore.setStatus('recognizing')
  }

  /** 发布经过控制器代次校验的 OCR 成功结果。 */
  function publishOCRResult(result: OCRResult): void {
    dependencies.ocrStore.setResult(result)
    dependencies.ocrStore.setStatus('ready')
  }

  /** 发布经过控制器代次校验的 OCR 失败消息。 */
  function publishOCRError(error: string): void {
    dependencies.ocrStore.setError(error)
  }

  return { captureFrame, publishOCRStarted, publishOCRResult, publishOCRError }
}
