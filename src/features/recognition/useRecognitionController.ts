import { useScreenCapture } from '../../composables/useScreenCapture'
import { useCaptureStore } from '../../stores/capture'
import { useConfigStore } from '../../stores/config'
import { useRecognitionStore } from '../../stores/recognition'
import type { CaptureFrame } from '../../types/capture'
import type { RecognitionPhase, RemoteQueryOptions, RemoteQueryResult, RemoteQuestionCandidate } from '../../types/remoteQuestion'
import { encodeQuestionScreenshot, queryRemoteScreenshot } from '../remote-query/remoteScreenshotClient'
import { createFrameMonitor } from './frameMonitor'
import { CAPTURE_INTERVAL_MS, MIN_QUERY_INTERVAL_MS, RATE_LIMIT_COOLDOWN_MS } from '../../../shared/recognition-policy.mjs'

interface RecognitionPresentation {
  /** 设置阶段和用户提示。 */
  setPhase(phase: RecognitionPhase, message: string): void
  /** 设置画面监测开关。 */
  setRunning(running: boolean): void
  /** 发布175dt候选结果。 */
  publishResult(candidates: RemoteQuestionCandidate[], durationMs: number): void
  /** 撤下旧题答案。 */
  clearResult(): void
  /** 累计真实网络查询次数。 */
  recordRequest(): void
}

export interface RecognitionControllerDependencies {
  /** 从共享窗口裁出当前题干，同时更新本地预览。 */
  captureFrame(): CaptureFrame | null | Promise<CaptureFrame | null>
  /** 将题干截图交给175dt，禁止本地OCR和本地题库回退。 */
  queryScreenshot(categoryId: string, frame: CaptureFrame, options: RemoteQueryOptions): Promise<RemoteQueryResult>
  /** 获取当前活动分类。 */
  getCategoryId(): string
  /** 获取整条识别请求的超时。 */
  getRequestTimeoutMs(): number
  /** 获取单调时钟。 */
  now(): number
  /** 等待下一次纯本地抽帧。 */
  sleep(durationMs: number): Promise<void>
  recognitionStore: RecognitionPresentation
}

export interface RecognitionController {
  /** 启动每秒四次的本地题干监测。 */
  start(): void
  /** 停止监测、取消上传并撤下答案。 */
  stop(): void
  /** 重新等待当前题干稳定，仍遵守请求间隔和限流冷却。 */
  retry(): Promise<void>
  /** 切换分类后丢弃旧识别上下文。 */
  resetForCategory(): void
}

/** 只在题干稳定后上传一次，画面变化立即取消旧题且拒绝迟到结果。 */
export function createRecognitionController(dependencies: RecognitionControllerDependencies): RecognitionController {
  const { recognitionStore: presentation, now, sleep } = dependencies
  const monitor = createFrameMonitor()
  let running = false
  let lifecycle = 0
  let scene = 0
  let queried = false
  let nextQueryAt = 0
  let request: AbortController | null = null
  let detectionTail = Promise.resolve()

  /** 取消当前题目请求，并使所有迟到回调失去发布资格。 */
  function invalidateScene(): void {
    scene += 1
    request?.abort()
    request = null
    presentation.clearResult()
  }

  /** 发出一张稳定题图，成功、空结果和失败都只自动尝试一次。 */
  async function solve(frame: CaptureFrame, generation: number): Promise<void> {
    const ownScene = scene
    const categoryId = dependencies.getCategoryId()
    const controller = new AbortController()
    request = controller
    queried = true
    const startedAt = now()
    nextQueryAt = Math.max(nextQueryAt, startedAt + MIN_QUERY_INTERVAL_MS)
    presentation.recordRequest()
    presentation.setPhase('primaryQuery', '正在通过175dt识别题干')
    /** 只有当前运行代次、画面和分类仍然一致时才能发布结果。 */
    function isCurrent(): boolean {
      return running && lifecycle === generation && scene === ownScene && !controller.signal.aborted && categoryId === dependencies.getCategoryId()
    }
    try {
      const result = await dependencies.queryScreenshot(categoryId, frame, {
        signal: controller.signal, timeoutMs: dependencies.getRequestTimeoutMs(),
      })
      if (!isCurrent()) return
      if (result.kind === 'success') {
        presentation.publishResult(result.candidates, Math.round(now() - startedAt))
        presentation.setPhase('showingAnswer', '175dt已返回答案，等待下一题')
      } else {
        if (result.kind === 'rateLimited') nextQueryAt = Math.max(nextQueryAt, now() + RATE_LIMIT_COOLDOWN_MS)
        presentation.setPhase('waitingRetry', result.kind === 'empty' ? '175dt未找到对应题目，请检查分类或选框后手动重试' : result.message)
      }
    } catch (error) {
      if (isCurrent()) presentation.setPhase('waitingRetry', error instanceof Error ? error.message : '截图识别失败，请手动重试')
    } finally {
      if (request === controller) request = null
    }
  }

  /** 捕获与检测都在本地完成，网络请求不阻塞后续换题监测。 */
  async function detect(generation: number): Promise<void> {
    if (!running || lifecycle !== generation) return
    const frame = await dependencies.captureFrame()
    if (!running || lifecycle !== generation || !frame) return
    const state = monitor.observe(frame.questionImage, now())
    if (state.changed) {
      invalidateScene()
      queried = false
    }
    if (state.blank) {
      presentation.setPhase('capturing', '选框内暂无题目，正在本地等待')
      return
    }
    if (!state.stable) {
      presentation.setPhase('stabilizing', '题干变化中，等待画面稳定')
      return
    }
    if (queried || request) return
    if (now() < nextQueryAt) {
      presentation.setPhase('stabilizing', `等待查询间隔，${Math.ceil((nextQueryAt - now()) / 1000)}秒后识别`)
      return
    }
    void solve(frame, generation)
  }

  /** 串行抽帧，停止后旧循环自动退出，不和新一轮共享画面交叉。 */
  async function run(generation: number): Promise<void> {
    while (running && lifecycle === generation) {
      detectionTail = detectionTail.then(() => detect(generation)).catch(error => {
        if (generation !== lifecycle) return
        running = false
        request?.abort()
        presentation.setRunning(false)
        presentation.clearResult()
        presentation.setPhase('waitingRetry', error instanceof Error ? error.message : '画面读取失败，请重新校准')
      })
      await detectionTail
      if (running && lifecycle === generation) await sleep(CAPTURE_INTERVAL_MS)
    }
  }

  /** 从新的稳定检测周期启动监测，保留限流预算。 */
  function start(): void {
    if (running || !dependencies.getCategoryId()) return
    running = true
    queried = false
    monitor.reset()
    invalidateScene()
    presentation.setRunning(true)
    presentation.setPhase('capturing', '正在监测题干，稳定后自动查询')
    void run(++lifecycle)
  }

  /** 停止后立即使在途结果失效，并清除屏幕上的旧答案。 */
  function stop(): void {
    running = false
    lifecycle += 1
    invalidateScene()
    monitor.reset()
    presentation.setRunning(false)
    presentation.setPhase('paused', '连续识别已停止')
  }

  /** 手动重试不会突破两秒间隔或一分钟限流保护。 */
  async function retry(): Promise<void> {
    if (!running) { start(); return }
    invalidateScene()
    queried = false
    monitor.reset()
    presentation.setPhase('stabilizing', '正在重新检查当前题干')
  }

  return { start, stop, retry, resetForCategory: stop }
}

/** 将唯一的175dt截图通道接入当前共享窗口和界面Store。 */
export function useRecognitionController(): RecognitionController {
  const captureStore = useCaptureStore()
  const configStore = useConfigStore()
  const recognitionStore = useRecognitionStore()
  const { captureCurrentFrame } = useScreenCapture()
  return createRecognitionController({
    /** 只发布题干裁剪帧，不读取选项或本地题库。 */
    captureFrame() {
      const frame = captureCurrentFrame(configStore.config.capture)
      if (frame) captureStore.setFrame(frame)
      return frame
    },
    /** 编码完成后再次检查取消状态，避免旧题进入上传队列。 */
    async queryScreenshot(categoryId, frame, options) {
      const blob = await encodeQuestionScreenshot(frame)
      if (options.signal?.aborted) return { kind: 'timeout', message: '请求已取消' }
      return await queryRemoteScreenshot(categoryId, blob, options)
    },
    getCategoryId: () => configStore.config.remoteQuery.categoryId,
    getRequestTimeoutMs: () => configStore.config.remoteQuery.requestTimeoutMs,
    now: () => performance.now(),
    sleep: async durationMs => await new Promise(resolve => setTimeout(resolve, durationMs)),
    recognitionStore,
  })
}
