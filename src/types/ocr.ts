/**
 * OCR 对一块图片区域的识别结果。
 */
export interface OCRTextBlock {
  text: string
  confidence: number
  /** PaddleOCR 返回的逐行文本和原图坐标，供预览层精确框选答案。 */
  lines?: OCRTextLine[]
}

export interface OCRTextLine {
  text: string
  confidence: number
  polygon: Array<[number, number]>
}

export interface OCRResult {
  question: OCRTextBlock
  options: OCRTextBlock
  durationMs: number
}

export type OCRStatus = 'idle' | 'initializing' | 'ready' | 'recognizing' | 'error'
