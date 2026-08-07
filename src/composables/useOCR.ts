import type {
  OcrResult as PaddleResult,
  OcrResultItem,
} from '@paddleocr/paddleocr-js'
import type { CaptureFrame } from '../types/capture'
import type { AppConfig } from '../types/config'
import type { OCRResult, OCRTextBlock } from '../types/ocr'

interface PaddleOCREngine {
  predict(input: unknown, params?: Record<string, unknown>): Promise<PaddleResult[]>
  dispose(): Promise<void>
}

const MODEL_DIRECTORY = 'models'
const DETECTION_MODEL = 'PP-OCRv5_mobile_det'
const RECOGNITION_MODEL = 'PP-OCRv5_mobile_rec'

let engine: PaddleOCREngine | null = null
let initialization: Promise<PaddleOCREngine> | null = null

export function useOCR() {
  /** 初始化 PP-OCRv5 移动端模型，并把推理放入独立线程避免阻塞界面。 */
  async function initializeOCR(): Promise<void> {
    await getOrCreateEngine()
  }

  /** 放大题干和选项截图后批量执行 PaddleOCR 检测与识别。 */
  async function recognizeFrame(
    frame: CaptureFrame,
    ocrOptions: AppConfig['ocr'],
  ): Promise<OCRResult> {
    const activeEngine = await getOrCreateEngine()
    const startedAt = performance.now()
    const scale = Math.max(1, ocrOptions.scale)
    const inputs = [
      scaleImageForPaddle(frame.questionImage, scale),
      scaleImageForPaddle(frame.optionsImage, scale),
    ]
    const [questionResult, optionsResult] = await activeEngine.predict(inputs, {
      textDetLimitType: 'min',
      textDetLimitSideLen: 320,
      textDetThresh: 0.25,
      textDetBoxThresh: 0.4,
      textDetUnclipRatio: 1.6,
      textRecScoreThresh: 0.25,
    })

    return {
      question: toTextBlock(questionResult),
      options: toTextBlock(optionsResult),
      durationMs: Math.round(performance.now() - startedAt),
    }
  }

  /** 销毁 PaddleOCR 模型会话并释放 WebGPU、WASM 与工作线程资源。 */
  async function terminateOCR(): Promise<void> {
    const activeEngine = engine
    engine = null
    initialization = null
    await activeEngine?.dispose()
  }

  return {
    initializeOCR,
    recognizeFrame,
    terminateOCR,
  }
}

/** 复用唯一的初始化任务，避免连续识别启动时重复加载二十余兆模型。 */
async function getOrCreateEngine(): Promise<PaddleOCREngine> {
  if (engine) return engine
  if (!initialization) {
    initialization = createPaddleEngine().catch((error) => {
      initialization = null
      throw error
    })
  }
  engine = await initialization
  return engine
}

/** 使用随 dist 发布的本地模型创建浏览器 OCR 引擎。 */
async function createPaddleEngine(): Promise<PaddleOCREngine> {
  if (location.protocol === 'file:') {
    throw new Error('PaddleOCR 模型不能通过 file:// 加载，请使用 npm run preview 或本地 HTTP 服务打开 dist')
  }

  const { PaddleOCR } = await import('@paddleocr/paddleocr-js')
  return await PaddleOCR.create({
    worker: true,
    textDetectionModelName: DETECTION_MODEL,
    textDetectionModelAsset: {
      url: resolvePublicAsset(`${MODEL_DIRECTORY}/${DETECTION_MODEL}_onnx_infer.tar`),
    },
    textRecognitionModelName: RECOGNITION_MODEL,
    textRecognitionModelAsset: {
      url: resolvePublicAsset(`${MODEL_DIRECTORY}/${RECOGNITION_MODEL}_onnx_infer.tar`),
    },
    textRecognitionBatchSize: 8,
    ortOptions: {
      backend: 'auto',
      // 单线程 WASM 无需服务器配置 COOP/COEP，普通静态服务器即可直接分享使用。
      numThreads: 1,
      simd: true,
    },
  })
}

/** 将 public 资源路径转换成绝对地址，确保工作线程不会相对 assets 目录取模型。 */
function resolvePublicAsset(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}${path}`, document.baseURI).href
}

/** 保留游戏原始颜色，仅做高质量放大，避免二值化破坏描边字体。 */
function scaleImageForPaddle(image: ImageData, scale: number): HTMLCanvasElement {
  const source = document.createElement('canvas')
  source.width = image.width
  source.height = image.height
  source.getContext('2d')?.putImageData(image, 0, 0)

  if (scale === 1) return source
  const target = document.createElement('canvas')
  target.width = Math.round(image.width * scale)
  target.height = Math.round(image.height * scale)
  const context = target.getContext('2d')
  if (!context) return source
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, target.width, target.height)
  return target
}

/** 按画面纵向顺序整理识别行，并计算按字符数加权的整体置信度。 */
function toTextBlock(result: PaddleResult | undefined): OCRTextBlock {
  if (!result?.items.length) {
    return { text: '', confidence: 0, lines: [] }
  }

  const items = [...result.items].sort(compareReadingOrder)
  const weightedLength = items.reduce((total, item) => total + Math.max(1, item.text.length), 0)
  const confidence = items.reduce(
    (total, item) => total + item.score * Math.max(1, item.text.length),
    0,
  ) / weightedLength

  return {
    text: items.map((item) => item.text.trim()).filter(Boolean).join('\n'),
    confidence,
    lines: items.map((item) => ({
      text: item.text,
      confidence: item.score,
      polygon: item.poly,
    })),
  }
}

/** 以文本框中心点确定自然阅读顺序，优先从上到下、同一行从左到右。 */
function compareReadingOrder(left: OcrResultItem, right: OcrResultItem): number {
  const leftCenter = getPolygonCenter(left.poly)
  const rightCenter = getPolygonCenter(right.poly)
  const lineTolerance = Math.max(getPolygonHeight(left.poly), getPolygonHeight(right.poly)) * 0.5
  return Math.abs(leftCenter.y - rightCenter.y) <= lineTolerance
    ? leftCenter.x - rightCenter.x
    : leftCenter.y - rightCenter.y
}

/** 计算四边形中心点。 */
function getPolygonCenter(polygon: Array<[number, number]>): { x: number; y: number } {
  const total = polygon.reduce(
    (position, [x, y]) => ({ x: position.x + x, y: position.y + y }),
    { x: 0, y: 0 },
  )
  const divisor = Math.max(1, polygon.length)
  return { x: total.x / divisor, y: total.y / divisor }
}

/** 计算文本四边形高度，用于判断两个框是否属于同一行。 */
function getPolygonHeight(polygon: Array<[number, number]>): number {
  const values = polygon.map(([, y]) => y)
  return values.length ? Math.max(...values) - Math.min(...values) : 0
}
