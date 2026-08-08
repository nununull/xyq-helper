import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'
import { readonly, reactive } from 'vue'

export type OCRPreparationPhase =
  | 'checking'
  | 'missing'
  | 'downloading'
  | 'loading-cache'
  | 'loading-runtime'
  | 'initializing'
  | 'ready'
  | 'error'

export interface OCRPreparationState {
  phase: OCRPreparationPhase
  loadedBytes: number
  totalBytes: number
  currentAsset: string
  cached: boolean
  error: string
}

interface OCRAssetDefinition {
  key: 'wasm' | 'detectionModel' | 'recognitionModel'
  label: string
  size: number
  url: string
}

export interface PreparedOCRAssets {
  wasmUrl: string
  detectionModelUrl: string
  recognitionModelUrl: string
  /** 释放本轮初始化创建的临时 Blob 地址。 */
  release(): void
}

const OCR_ASSET_CACHE = 'xyq-ocr-assets-v1'
const OCR_ASSET_VERSION = 'v1'
const MODEL_DIRECTORY = 'models'
const DETECTION_MODEL = 'PP-OCRv5_mobile_det'
const RECOGNITION_MODEL = 'PP-OCRv5_mobile_rec'

const state = reactive<OCRPreparationState>({
  phase: 'checking',
  loadedBytes: 0,
  totalBytes: 0,
  currentAsset: '正在检查本地缓存',
  cached: false,
  error: '',
})

let inspection: Promise<boolean> | null = null

/** 返回当前构建所需的本地 OCR 资源清单。 */
function getAssetDefinitions(): OCRAssetDefinition[] {
  return [
    {
      key: 'wasm',
      label: 'OCR 运行组件',
      size: 26_827_543,
      url: ortWasmUrl,
    },
    {
      key: 'detectionModel',
      label: '文字检测模型',
      size: 4_843_520,
      url: resolvePublicAsset(`${MODEL_DIRECTORY}/${DETECTION_MODEL}_onnx_infer.tar`),
    },
    {
      key: 'recognitionModel',
      label: '中文识别模型',
      size: 16_701_440,
      url: resolvePublicAsset(`${MODEL_DIRECTORY}/${RECOGNITION_MODEL}_onnx_infer.tar`),
    },
  ]
}

/** 检查当前版本 OCR 资源是否已经全部保存在浏览器缓存中。 */
export async function inspectOCRAssets(): Promise<boolean> {
  if (state.phase === 'ready' || state.cached) return true
  if (inspection) return await inspection

  inspection = (async () => {
    state.phase = 'checking'
    state.currentAsset = '正在检查本地缓存'
    const definitions = getAssetDefinitions()
    state.totalBytes = definitions.reduce((total, item) => total + item.size, 0)
    state.loadedBytes = 0

    const cache = await openAssetCache()
    if (!cache) {
      state.phase = 'missing'
      state.currentAsset = ''
      return false
    }

    for (const asset of definitions) {
      if (!await readCachedAsset(cache, asset)) {
        state.phase = 'missing'
        state.currentAsset = ''
        return false
      }
      state.loadedBytes += asset.size
    }

    state.cached = true
    state.phase = 'loading-cache'
    state.currentAsset = 'OCR 资源已缓存'
    return true
  })().finally(() => {
    inspection = null
  })

  return await inspection
}

/** 下载或读取 OCR 资源，并生成供 PaddleOCR 初始化使用的临时地址。 */
export async function prepareOCRAssets(): Promise<PreparedOCRAssets> {
  const definitions = getAssetDefinitions()
  const totalBytes = definitions.reduce((total, item) => total + item.size, 0)
  const cache = await openAssetCache()
  const urls = new Map<OCRAssetDefinition['key'], string>()
  const temporaryUrls: string[] = []
  let completedBytes = 0

  state.totalBytes = totalBytes
  state.loadedBytes = 0
  state.error = ''

  try {
    for (const asset of definitions) {
      const cachedResponse = cache ? await readCachedAsset(cache, asset) : undefined
      state.phase = cachedResponse ? 'loading-cache' : 'downloading'
      state.currentAsset = cachedResponse ? `正在读取${asset.label}` : `正在下载${asset.label}`

      const blob = cachedResponse
        ? await cachedResponse.blob()
        : await downloadAsset(asset, cache, completedBytes)
      completedBytes += asset.size
      state.loadedBytes = Math.min(completedBytes, totalBytes)

      const temporaryUrl = URL.createObjectURL(blob)
      temporaryUrls.push(temporaryUrl)
      urls.set(asset.key, temporaryUrl)
    }

    state.cached = Boolean(cache)
    state.phase = 'loading-runtime'
    state.currentAsset = '正在加载 OCR 运行环境'

    return {
      wasmUrl: requirePreparedUrl(urls, 'wasm'),
      detectionModelUrl: requirePreparedUrl(urls, 'detectionModel'),
      recognitionModelUrl: requirePreparedUrl(urls, 'recognitionModel'),
      /** 释放仅供模型初始化读取的临时资源地址。 */
      release() {
        for (const url of temporaryUrls) URL.revokeObjectURL(url)
      },
    }
  } catch (error) {
    for (const url of temporaryUrls) URL.revokeObjectURL(url)
    markOCRPreparationError(error)
    throw error
  }
}

/** 将 OCR 准备阶段同步给所有使用方。 */
export function setOCRPreparationPhase(
  phase: OCRPreparationPhase,
  currentAsset: string,
): void {
  state.phase = phase
  state.currentAsset = currentAsset
  if (phase === 'ready') {
    state.loadedBytes = state.totalBytes
    state.error = ''
  }
}

/** 记录 OCR 资源准备失败的可读错误。 */
export function markOCRPreparationError(error: unknown): void {
  state.phase = 'error'
  state.currentAsset = ''
  state.error = error instanceof Error ? error.message : 'OCR 资源准备失败'
}

/** 暴露只读的 OCR 下载与初始化状态。 */
export function useOCRAssetLoader() {
  return {
    preparation: readonly(state),
    inspectOCRAssets,
  }
}

/** 流式下载单个资源并持续更新真实的已接收字节数。 */
async function downloadAsset(
  asset: OCRAssetDefinition,
  cache: Cache | null,
  completedBytes: number,
): Promise<Blob> {
  const response = await fetch(asset.url)
  if (!response.ok || !response.body) {
    throw new Error(`${asset.label}下载失败`)
  }

  const reader = response.body.getReader()
  const chunks: ArrayBuffer[] = []
  let receivedBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = new Uint8Array(value.byteLength)
    chunk.set(value)
    chunks.push(chunk.buffer)
    receivedBytes += value.byteLength
    state.loadedBytes = Math.min(completedBytes + receivedBytes, state.totalBytes)
  }

  const blob = new Blob(chunks, {
    type: response.headers.get('content-type') ?? 'application/octet-stream',
  })
  if (cache) await persistCachedAsset(cache, asset, blob)
  return blob
}

/** 生成与构建产物哈希和查询参数无关的稳定缓存键。 */
function getAssetCacheKey(asset: OCRAssetDefinition): string {
  return new URL(
    `${import.meta.env.BASE_URL}__ocr_cache__/${OCR_ASSET_VERSION}/${asset.key}`,
    document.baseURI,
  ).href
}

/** 读取 OCR 资源，并将旧版 URL 缓存迁移到稳定缓存键。 */
async function readCachedAsset(
  cache: Cache,
  asset: OCRAssetDefinition,
): Promise<Response | undefined> {
  const stableKey = getAssetCacheKey(asset)
  const cached = await cache.match(stableKey)
  if (cached) return cached

  const legacyCached = await cache.match(asset.url)
  if (!legacyCached) return undefined
  try {
    await cache.put(stableKey, legacyCached.clone())
  } catch (error) {
    console.warn(`${asset.label}迁移到稳定缓存键失败。`, error)
  }
  return legacyCached
}

/** 将完整 Blob 写入稳定缓存键，避免流复制失败或构建 URL 变化导致缓存失效。 */
async function persistCachedAsset(
  cache: Cache,
  asset: OCRAssetDefinition,
  blob: Blob,
): Promise<void> {
  try {
    await cache.put(getAssetCacheKey(asset), new Response(blob, {
      headers: {
        'Content-Type': blob.type || 'application/octet-stream',
        'Content-Length': String(blob.size),
      },
    }))
  } catch (error) {
    console.warn(`${asset.label}写入浏览器缓存失败。`, error)
  }
}

/** 打开版本化资源缓存；隐私模式或配额受限时自动退化为会话下载。 */
async function openAssetCache(): Promise<Cache | null> {
  if (!('caches' in window)) return null
  try {
    return await caches.open(OCR_ASSET_CACHE)
  } catch (error) {
    console.warn('浏览器缓存不可用，OCR 资源仅在本次会话中保留。', error)
    return null
  }
}

/** 获取已经生成的资源地址，缺失时立即终止错误初始化。 */
function requirePreparedUrl(
  urls: Map<OCRAssetDefinition['key'], string>,
  key: OCRAssetDefinition['key'],
): string {
  const url = urls.get(key)
  if (!url) throw new Error('OCR 资源准备不完整')
  return url
}

/** 将 public 资源路径转换成兼容站点子目录的绝对地址。 */
function resolvePublicAsset(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}${path}`, document.baseURI).href
}
