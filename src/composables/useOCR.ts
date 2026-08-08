import type {
  OcrResult as PaddleResult,
  OcrResultItem,
} from '@paddleocr/paddleocr-js'
import { readonly, ref } from 'vue'
import type { CaptureFrame } from '../types/capture'
import type { AppConfig } from '../types/config'
import type { OCRResult, OCRTextBlock } from '../types/ocr'
import {
  inspectOCRAssets,
  markOCRPreparationError,
  prepareOCRAssets,
  setOCRPreparationPhase,
  useOCRAssetLoader,
} from './useOCRAssetLoader'

interface PaddleOCREngine {
  predict(input: unknown, params?: Record<string, unknown>): Promise<PaddleResult[]>
  dispose(): Promise<void>
}

const DETECTION_MODEL = 'PP-OCRv5_mobile_det'
const RECOGNITION_MODEL = 'PP-OCRv5_mobile_rec'

let engine: PaddleOCREngine | null = null
let initialization: Promise<PaddleOCREngine> | null = null
const runtimeMode = ref<'uninitialized' | 'worker' | 'main-thread' | 'error'>('uninitialized')

interface OCRImageSurface {
  source: HTMLCanvasElement
  target: HTMLCanvasElement
}

const imageSurfaces: OCRImageSurface[] = []

export function useOCR() {
  const assetLoader = useOCRAssetLoader()

  /** 初始化 PP-OCRv5 移动端模型。 */
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
    if (frame.answerImage) {
      const [combinedResult] = await activeEngine.predict(
        scaleImageForPaddle(frame.answerImage, scale, 0),
        OCR_PARAMETERS,
      )
      const { questionItems, optionItems } = splitAnswerItems(combinedResult?.items ?? [])
      return {
        question: toTextBlockFromItems(questionItems),
        options: toTextBlockFromItems(optionItems),
        durationMs: Math.round(performance.now() - startedAt),
      }
    }

    const inputs = [
      scaleImageForPaddle(frame.questionImage, scale, 0),
      scaleImageForPaddle(frame.optionsImage, scale, 1),
    ]
    const [questionResult, optionsResult] = await activeEngine.predict(inputs, OCR_PARAMETERS)

    return {
      question: toTextBlock(questionResult),
      options: toTextBlock(optionsResult),
      durationMs: Math.round(performance.now() - startedAt),
    }
  }

  /** 销毁 PaddleOCR 模型会话并释放 WebGPU 与 WASM 资源。 */
  async function terminateOCR(): Promise<void> {
    const activeEngine = engine
    engine = null
    initialization = null
    runtimeMode.value = 'uninitialized'
    await activeEngine?.dispose()
  }

  return {
    initializeOCR,
    recognizeFrame,
    terminateOCR,
    runtimeMode: readonly(runtimeMode),
    preparation: assetLoader.preparation,
    inspectAssets: inspectOCRAssets,
  }
}

/** 复用唯一的初始化任务，避免连续识别启动时重复加载二十余兆模型。 */
async function getOrCreateEngine(): Promise<PaddleOCREngine> {
  if (engine) return engine
  if (!initialization) {
    initialization = createPaddleEngine().catch((error) => {
      initialization = null
      runtimeMode.value = 'error'
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

  const assets = await prepareOCRAssets()
  try {
    const [ort, { PaddleOCR }] = await Promise.all([
      import('onnxruntime-web'),
      import('@paddleocr/paddleocr-js'),
    ])
    // 模型内未使用的初始化器由 ORT 自动清理，仅隐藏不会影响推理结果的运行时警告。
    ort.env.logLevel = 'error'
    setOCRPreparationPhase('initializing', '正在创建 OCR 识别引擎')
    const sharedOptions = {
      textDetectionModelName: DETECTION_MODEL,
      textDetectionModelAsset: { url: assets.detectionModelUrl },
      textRecognitionModelName: RECOGNITION_MODEL,
      textRecognitionModelAsset: { url: assets.recognitionModelUrl },
      textRecognitionBatchSize: 8,
      ortOptions: {
        // 固定 WASM，避免 WebGPU 会话创建失败后污染 ORT 的后端降级状态。
        backend: 'wasm',
        // PaddleOCR 类型仍限定为字符串，运行时会原样转交 ORT 支持的精确资源映射。
        wasmPaths: { wasm: assets.wasmUrl } as unknown as string,
        // 单线程 WASM 无需服务器配置 COOP/COEP，普通静态服务器即可直接分享使用。
        numThreads: 1,
        simd: true,
      },
    } as const

    try {
      const workerEngine = await PaddleOCR.create({ ...sharedOptions, worker: true })
      runtimeMode.value = 'worker'
      setOCRPreparationPhase('ready', 'OCR 已就绪')
      return workerEngine
    } catch (workerError) {
      // 部分浏览器或静态服务器无法加载包内 module worker，自动降级以保证识别仍可使用。
      console.warn('OCR Worker 初始化失败，已切换到主线程模式。', workerError)
      const mainThreadEngine = await PaddleOCR.create({ ...sharedOptions, worker: false })
      runtimeMode.value = 'main-thread'
      setOCRPreparationPhase('ready', 'OCR 已就绪')
      return mainThreadEngine
    }
  } catch (error) {
    markOCRPreparationError(error)
    throw error
  } finally {
    assets.release()
  }
}

/** 保留游戏原始颜色，仅做高质量放大，避免二值化破坏描边字体。 */
function scaleImageForPaddle(
  image: ImageData,
  scale: number,
  surfaceIndex: number,
): HTMLCanvasElement {
  const surface = getImageSurface(surfaceIndex)
  const { source, target } = surface
  if (source.width !== image.width) source.width = image.width
  if (source.height !== image.height) source.height = image.height
  // PaddleOCR 会从输入画布回读像素，创建上下文时直接声明高频读取用途。
  source.getContext('2d', { willReadFrequently: true })?.putImageData(image, 0, 0)

  if (scale === 1) return source
  const targetWidth = Math.round(image.width * scale)
  const targetHeight = Math.round(image.height * scale)
  if (target.width !== targetWidth) target.width = targetWidth
  if (target.height !== targetHeight) target.height = targetHeight
  // 放大后的画布同样会被 OCR 管线通过 getImageData 读取。
  const context = target.getContext('2d', { willReadFrequently: true })
  if (!context) return source
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, target.width, target.height)
  return target
}

/** 按输入槽复用 OCR 画布，避免连续识别时频繁创建画布并触发垃圾回收。 */
function getImageSurface(index: number): OCRImageSurface {
  if (!imageSurfaces[index]) {
    imageSurfaces[index] = {
      source: document.createElement('canvas'),
      target: document.createElement('canvas'),
    }
  }
  return imageSurfaces[index]
}

/** 按画面纵向顺序整理识别行，并计算按字符数加权的整体置信度。 */
function toTextBlock(result: PaddleResult | undefined): OCRTextBlock {
  return toTextBlockFromItems(result?.items ?? [])
}

/** 将已分类的 OCR 文本行整理为展示和匹配所需的文本块。 */
function toTextBlockFromItems(itemsSource: OcrResultItem[]): OCRTextBlock {
  if (!itemsSource.length) {
    return { text: '', confidence: 0, lines: [] }
  }

  const items = [...itemsSource].sort(compareReadingOrder)
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

const OCR_PARAMETERS = {
  textDetLimitType: 'min',
  textDetLimitSideLen: 320,
  textDetThresh: 0.25,
  textDetBoxThresh: 0.4,
  textDetUnclipRatio: 1.6,
  textRecScoreThresh: 0.25,
}

/** 将完整答题窗口中的文字行自动分为题干和选项。 */
function splitAnswerItems(itemsSource: OcrResultItem[]): {
  questionItems: OcrResultItem[]
  optionItems: OcrResultItem[]
} {
  const items = [...itemsSource].sort(compareReadingOrder)
  if (items.length <= 1) return { questionItems: items, optionItems: [] }

  const markedOptionIndex = items.findIndex((item) => /^[A-DＡ-Ｄ][.。:：、\s]/i.test(item.text.trim()))
  if (markedOptionIndex > 0) {
    return {
      questionItems: items.slice(0, markedOptionIndex),
      optionItems: items.slice(markedOptionIndex),
    }
  }

  const minimumBoundary = Math.max(1, items.length - 4)
  const maximumBoundary = Math.max(minimumBoundary, items.length - 2)
  let boundary = minimumBoundary
  let largestGap = Number.NEGATIVE_INFINITY
  for (let index = minimumBoundary; index <= maximumBoundary; index += 1) {
    const upper = items[index - 1]
    const lower = items[index]
    if (!upper || !lower) continue
    const gap = getPolygonCenter(lower.poly).y - getPolygonCenter(upper.poly).y
      - (getPolygonHeight(upper.poly) + getPolygonHeight(lower.poly)) / 2
    if (gap > largestGap) {
      largestGap = gap
      boundary = index
    }
  }
  return {
    questionItems: items.slice(0, boundary),
    optionItems: items.slice(boundary),
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
