/**
 * OCR 对一块图片区域的识别结果。
 */
export interface OCRTextBlock {
  text: string
  confidence: number
}

export interface OCRResult {
  question: OCRTextBlock
  options: OCRTextBlock
  durationMs: number
}

export type OCRStatus = 'idle' | 'initializing' | 'ready' | 'recognizing' | 'error'
