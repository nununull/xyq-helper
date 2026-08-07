import { createWorker, PSM, type Worker } from 'tesseract.js'
import type { CaptureFrame } from '../types/capture'
import type { AppConfig } from '../types/config'
import type { OCRResult } from '../types/ocr'
import { preprocessImage } from '../utils/preprocess'

let worker: Worker | null = null

export function useOCR() {
  /** 初始化中文 OCR 工作线程，并使用适合游戏文本区域的分页模式。 */
  async function initializeOCR(): Promise<void> {
    if (worker) {
      return
    }

    worker = await createWorker('chi_sim')
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      preserve_interword_spaces: '1',
    })
  }

  /** 预处理题干和选项截图后执行中文文字识别。 */
  async function recognizeFrame(
    frame: CaptureFrame,
    ocrOptions: AppConfig['ocr'],
  ): Promise<OCRResult> {
    if (!worker) {
      await initializeOCR()
    }

    if (!worker) {
      throw new Error('OCR 引擎初始化失败')
    }

    const startedAt = performance.now()
    const questionImage = preprocessImage(frame.questionImage, ocrOptions)
    const optionsImage = preprocessImage(frame.optionsImage, ocrOptions)
    const [question, optionResult] = await Promise.all([
      worker.recognize(imageDataToCanvas(questionImage)),
      worker.recognize(imageDataToCanvas(optionsImage)),
    ])

    return {
      question: {
        text: question.data.text,
        confidence: question.data.confidence / 100,
      },
      options: {
        text: optionResult.data.text,
        confidence: optionResult.data.confidence / 100,
      },
      durationMs: Math.round(performance.now() - startedAt),
    }
  }

  /** 终止 OCR 工作线程并释放浏览器资源。 */
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

/** 将预处理后的像素数据转换为 Tesseract 可识别的画布。 */
function imageDataToCanvas(image: ImageData): HTMLCanvasElement {
  const borderSize = 10
  const canvas = document.createElement('canvas')
  canvas.width = image.width + borderSize * 2
  canvas.height = image.height + borderSize * 2
  const context = canvas.getContext('2d')
  if (context) {
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.putImageData(image, borderSize, borderSize)
  }
  return canvas
}
