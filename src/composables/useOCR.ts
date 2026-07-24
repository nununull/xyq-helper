import { createWorker, type Worker } from 'tesseract.js'
import type { CaptureFrame } from '../types/capture'
import type { OCRResult } from '../types/ocr'

let worker: Worker | null = null

export function useOCR() {
  async function initializeOCR(): Promise<void> {
    if (worker) {
      return
    }

    worker = await createWorker('chi_sim')
  }

  async function recognizeFrame(frame: CaptureFrame): Promise<OCRResult> {
    if (!worker) {
      await initializeOCR()
    }

    if (!worker) {
      throw new Error('OCR 引擎初始化失败')
    }

    const startedAt = performance.now()
    const [question, options] = await Promise.all([
      worker.recognize(imageDataToCanvas(frame.questionImage)),
      worker.recognize(imageDataToCanvas(frame.optionsImage)),
    ])

    return {
      question: {
        text: question.data.text,
        confidence: question.data.confidence / 100,
      },
      options: {
        text: options.data.text,
        confidence: options.data.confidence / 100,
      },
      durationMs: Math.round(performance.now() - startedAt),
    }
  }

  async function terminateOCR(): Promise<void> {
    await worker?.terminate()
    worker = null
  }

  return {
    initializeOCR,
    recognizeFrame,
    terminateOCR,
  }
}

function imageDataToCanvas(image: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (context) {
    context.putImageData(image, 0, 0)
  }
  return canvas
}
