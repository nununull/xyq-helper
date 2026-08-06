import { useOCR } from '../../composables/useOCR'
import {
  getRemoteQuestionCache,
  putRemoteQuestionCache,
} from '../../composables/useLocalStorageDB'
import { useScreenCapture } from '../../composables/useScreenCapture'
import { useConfigStore } from '../../stores/config'
import { useMatcherStore } from '../../stores/matcher'
import { useRecognitionStore } from '../../stores/recognition'
import type { CaptureFrame } from '../../types/capture'
import type { MatchResult } from '../../types/match'
import type { OCRResult } from '../../types/ocr'
import type { ParsedQuestion } from '../../types/question'
import type {
  RecognitionPhase,
  RemoteQueryOptions,
  RemoteQueryResult,
  RemoteQuestionCache,
} from '../../types/remoteQuestion'
import { parseQuestion } from '../../utils/parseQuestion'
import {
  cleanRemoteQueryText,
  createQuestionFingerprint,
  selectFallbackKeyword,
} from '../remote-query/queryText'
import {
  inferRemoteAnswer,
  rankRemoteCandidates,
  type RemoteMatchDecision,
} from '../remote-query/remoteCandidateMatcher'
import { queryRemoteQuestions } from '../remote-query/remoteQuestionClient'
import { createQuestionStabilizer } from './questionStabilizer'

const POLL_INTERVAL_MS = 500
const QUESTION_FAILURE_COOLDOWN_MS = 10_000
const CATEGORY_RATE_LIMIT_COOLDOWN_MS = 60_000

interface RecognitionStorePort {
  readonly lastCompletedFingerprint: string | null
  /** 同步识别阶段及其用户提示。 */
  setPhase(phase: RecognitionPhase, message: string): void
  /** 同步连续识别是否运行。 */
  setRunning(running: boolean): void
  /** 记录最近完成的题目指纹。 */
  setLastCompletedFingerprint(fingerprint: string | null): void
  /** 记录本次答案来源与求解耗时。 */
  setOutcome(resultSource: 'cache' | 'remote', durationMs: number): void
}

interface MatcherStorePort {
  /** 发布或清空当前匹配结果。 */
  setResult(result: MatchResult | null): void
  /** 发布或清空当前匹配错误。 */
  setError(error: string): void
  /** 清空当前匹配上下文。 */
  clear(): void
}

export interface RecognitionControllerDependencies {
  /** 捕获当前配置区域的一帧图像。 */
  captureFrame(): CaptureFrame | null | Promise<CaptureFrame | null>
  /** 串行识别一帧中的题干和选项。 */
  recognizeFrame(frame: CaptureFrame): Promise<OCRResult>
  /** 查询指定活动分类的远程题库。 */
  query(categoryId: string, queryText: string, options: RemoteQueryOptions): Promise<RemoteQueryResult>
  /** 等待下一次轮询间隔。 */
  sleep(durationMs: number): Promise<void>
  /** 按分类和题目指纹读取缓存。 */
  readCache(categoryId: string, fingerprint: string): Promise<RemoteQuestionCache | undefined>
  /** 持久化新增或更新后的缓存。 */
  writeCache(record: RemoteQuestionCache): Promise<void>
  /** 读取当前活动分类。 */
  getCategoryId(): string
  /** 读取当前远程请求超时。 */
  getRequestTimeoutMs(): number
  /** 读取当前时钟，用于缓存统计与冷却判断。 */
  now(): number
  recognitionStore: RecognitionStorePort
  matcherStore: MatcherStorePort
}

export interface RecognitionController {
  /** 启动连续识别。 */
  start(): void
  /** 停止连续识别并废弃在途结果。 */
  stop(): void
  /** 绕过当前题目冷却并立即重试。 */
  retry(): Promise<void>
  /** 为新的活动分类重置识别上下文。 */
  resetForCategory(): void
}

/** 创建依赖可替换的串行连续识别控制器。 */
export function createRecognitionController(
  dependencies: RecognitionControllerDependencies,
): RecognitionController {
  const {
    captureFrame,
    recognizeFrame,
    query,
    sleep,
    readCache,
    writeCache,
    getCategoryId,
    getRequestTimeoutMs,
    now,
    recognitionStore,
    matcherStore,
  } = dependencies
  const stabilizer = createQuestionStabilizer()
  const questionFailureCooldowns = new Map<string, number>()
  const categoryRateLimitCooldowns = new Map<string, number>()

  let running = false
  let loopPromise: Promise<void> | null = null
  let cycleTail: Promise<void> = Promise.resolve()
  let activeGeneration = 0
  let currentSolveGeneration = 0
  let activeRequestController: AbortController | null = null
  let lastProcessedFrameHash: string | null = null
  let lastStableFingerprint: string | null = null
  let activeFingerprint: string | null = null
  let activeCategoryId: string | null = null

  /** 判断异步结果是否仍属于当前识别代次。 */
  function canPublish(requestController = activeRequestController): boolean {
    return currentSolveGeneration === activeGeneration
      && requestController === activeRequestController
      && !requestController?.signal.aborted
  }

  /** 以固定文案发布等待重试状态，并登记对应冷却时间。 */
  function publishFailure(
    result: Exclude<RemoteQueryResult, { kind: 'success' | 'empty' }>,
  ): void {
    if (!canPublish() || !activeFingerprint || !activeCategoryId) return

    const messages = {
      corsBlocked: '可能是 CORS 或网络错误',
      timeout: '远程题库响应超时',
      rateLimited: '接口暂时拒绝请求',
      malformedResponse: '远程接口格式发生变化',
    } as const
    const message = result.kind === 'remoteError'
      ? result.message || '远程请求失败'
      : messages[result.kind]

    if (result.kind === 'rateLimited') {
      categoryRateLimitCooldowns.set(activeCategoryId, now() + CATEGORY_RATE_LIMIT_COOLDOWN_MS)
    } else {
      questionFailureCooldowns.set(activeFingerprint, now() + QUESTION_FAILURE_COOLDOWN_MS)
    }
    matcherStore.setError(message)
    recognitionStore.setPhase('waitingRetry', message)
  }

  /** 发布缓存答案，并使用本次选项重新推导答案字母。 */
  async function publishCachedResult(
    cached: RemoteQuestionCache,
    parsed: ParsedQuestion,
    startedAt: number,
  ): Promise<void> {
    if (!canPublish()) return
    const inferred = inferRemoteAnswer(cached.answerText, parsed.options)
    const updated = {
      ...cached,
      lastUsedAt: now(),
      hitCount: cached.hitCount + 1,
    }
    await writeCache(updated)
    if (!canPublish()) return

    const durationMs = Math.max(0, Math.round(performance.now() - startedAt))
    matcherStore.setResult({
      questionId: cached.id,
      answer: inferred.answer,
      answerText: cached.answerText,
      confidence: cached.matchConfidence,
      matchedQuestion: cached.matchedQuestion,
      source: cached.source,
      resultSource: 'cache',
      durationMs,
      candidates: [],
    })
    recognitionStore.setOutcome('cache', durationMs)
    recognitionStore.setLastCompletedFingerprint(cached.questionFingerprint)
    recognitionStore.setPhase('showingAnswer', '已从本地缓存找到答案')
  }

  /** 发布候选决策；仅 confident 和 lowConfidence 写入成功缓存。 */
  async function publishDecision(
    decision: RemoteMatchDecision,
    categoryId: string,
    fingerprint: string,
    parsed: ParsedQuestion,
    startedAt: number,
  ): Promise<void> {
    if (!canPublish()) return
    if (decision.kind === 'rejected' || !decision.best) {
      questionFailureCooldowns.set(fingerprint, now() + QUESTION_FAILURE_COOLDOWN_MS)
      const message = '未找到可靠答案，请手动重试'
      matcherStore.setError(message)
      recognitionStore.setPhase('waitingRetry', message)
      return
    }
    if (decision.kind === 'ambiguous') {
      questionFailureCooldowns.set(fingerprint, now() + QUESTION_FAILURE_COOLDOWN_MS)
      const message = '候选答案过于接近，请手动重试'
      matcherStore.setError(message)
      recognitionStore.setPhase('waitingRetry', message)
      return
    }

    const best = decision.best
    const cachedAt = now()
    const cacheRecord: RemoteQuestionCache = {
      id: `${categoryId}:${fingerprint}`,
      categoryId,
      questionFingerprint: fingerprint,
      recognizedQuestion: parsed.questionText,
      matchedQuestion: best.question,
      answerText: best.answerText,
      source: best.source,
      matchConfidence: best.confidence,
      createdAt: cachedAt,
      lastUsedAt: cachedAt,
      hitCount: 1,
    }
    await writeCache(cacheRecord)
    if (!canPublish()) return

    const durationMs = Math.max(0, Math.round(performance.now() - startedAt))
    const warning = decision.kind === 'lowConfidence' ? '匹配置信度较低，请核对答案' : undefined
    matcherStore.setResult({
      questionId: cacheRecord.id,
      answer: best.answer,
      answerText: best.answerText,
      confidence: best.confidence,
      matchedQuestion: best.question,
      source: best.source,
      resultSource: 'remote',
      durationMs,
      warning,
      candidates: [],
    })
    recognitionStore.setOutcome('remote', durationMs)
    recognitionStore.setLastCompletedFingerprint(fingerprint)
    recognitionStore.setPhase('showingAnswer', warning ?? '已找到远程答案')
  }

  /** 为一个已经稳定的题目执行缓存、远程查询、排序和结果发布。 */
  async function solveStableQuestion(parsed: ParsedQuestion, ocrConfidence: number): Promise<void> {
    const startedAt = performance.now()
    const categoryId = getCategoryId()
    const fingerprint = createQuestionFingerprint(parsed.normalizedQuestion)
    if (!categoryId || fingerprint === recognitionStore.lastCompletedFingerprint) return

    activeRequestController?.abort()
    const requestController = new AbortController()
    activeRequestController = requestController
    currentSolveGeneration = activeGeneration
    activeFingerprint = fingerprint
    activeCategoryId = categoryId

    recognitionStore.setPhase('cacheLookup', '正在查询本地缓存')
    const cached = await readCache(categoryId, fingerprint)
    if (!canPublish(requestController)) return
    if (cached) {
      await publishCachedResult(cached, parsed, startedAt)
      return
    }

    recognitionStore.setPhase('primaryQuery', '正在查询远程题库')
    const primary = await query(categoryId, cleanRemoteQueryText(parsed.questionText), {
      signal: requestController.signal,
      timeoutMs: getRequestTimeoutMs(),
    })
    if (!canPublish(requestController)) return
    let candidates = primary.kind === 'success' ? primary.candidates : []

    if (primary.kind === 'empty') {
      const fallback = selectFallbackKeyword(parsed.questionText)
      if (fallback) {
        recognitionStore.setPhase('fallbackQuery', '正在使用关键词重试')
        const secondary = await query(categoryId, fallback, {
          signal: requestController.signal,
          timeoutMs: getRequestTimeoutMs(),
        })
        if (!canPublish(requestController)) return
        if (secondary.kind === 'success') candidates = secondary.candidates
        else if (secondary.kind !== 'empty') return publishFailure(secondary)
      }
    } else if (primary.kind !== 'success') {
      publishFailure(primary)
      return
    }

    recognitionStore.setPhase('matching', '正在匹配候选题')
    const decision = rankRemoteCandidates(parsed, candidates, ocrConfidence)
    await publishDecision(decision, categoryId, fingerprint, parsed, startedAt)
  }

  /** 捕获并串行处理一帧，所有异步边界均校验识别代次。 */
  async function processFrame(scheduledGeneration: number): Promise<void> {
    if (scheduledGeneration !== activeGeneration) return
    const generation = ++activeGeneration
    matcherStore.setError('')
    recognitionStore.setPhase('capturing', '正在捕获题目画面')
    const captured = await captureFrame()
    if (generation !== activeGeneration || !captured) return
    if (captured.frameHash === lastProcessedFrameHash) return
    lastProcessedFrameHash = captured.frameHash

    recognitionStore.setPhase('recognizing', '正在识别题目文字')
    const recognized = await recognizeFrame(captured)
    if (generation !== activeGeneration) return

    recognitionStore.setPhase('stabilizing', '正在确认题目稳定性')
    const parsed = parseQuestion(recognized)
    const stable = stabilizer.push(parsed)
    if (!stable) return

    const fingerprint = createQuestionFingerprint(stable.normalizedQuestion)
    lastStableFingerprint = fingerprint
    if (fingerprint === recognitionStore.lastCompletedFingerprint) return
    if ((questionFailureCooldowns.get(fingerprint) ?? 0) > now()) {
      recognitionStore.setPhase('waitingRetry', '当前题目暂在失败冷却中')
      return
    }

    const categoryId = getCategoryId()
    if ((categoryRateLimitCooldowns.get(categoryId) ?? 0) > now()) {
      recognitionStore.setPhase('waitingRetry', '当前分类请求过于频繁，请稍后重试')
      return
    }

    const ocrConfidence = (recognized.question.confidence + recognized.options.confidence) / 2
    await solveStableQuestion(stable, ocrConfidence)
  }

  /** 将一次识别帧追加到共享串行队列，避免 OCR 或请求重叠。 */
  function enqueueFrame(): Promise<void> {
    const scheduledGeneration = activeGeneration
    const cycle = cycleTail
      .catch(() => undefined)
      .then(() => processFrame(scheduledGeneration))
    cycleTail = cycle
    return cycle
  }

  /** 按固定间隔持续调度串行识别帧。 */
  async function runLoop(): Promise<void> {
    while (running) {
      try {
        await enqueueFrame()
      } catch (error) {
        if (running) {
          const message = error instanceof Error ? error.message : '连续识别发生异常'
          matcherStore.setError(message)
          recognitionStore.setPhase('waitingRetry', message)
        }
      }
      if (!running) break
      await sleep(POLL_INTERVAL_MS)
    }
  }

  return {
    /** 启动连续识别循环；重复调用不会创建第二个循环。 */
    start(): void {
      if (running) return
      running = true
      recognitionStore.setRunning(true)
      if (!loopPromise) {
        const currentLoop = runLoop()
        loopPromise = currentLoop
        void currentLoop.then(() => {
          if (loopPromise === currentLoop) loopPromise = null
        }, () => {
          if (loopPromise === currentLoop) loopPromise = null
        })
      }
    },

    /** 停止识别、中止活动请求，并使全部在途结果失效。 */
    stop(): void {
      running = false
      activeGeneration += 1
      activeRequestController?.abort()
      activeRequestController = null
      recognitionStore.setRunning(false)
      recognitionStore.setPhase('paused', '连续识别已暂停')
    },

    /** 清除当前题目失败冷却并立即串行处理一帧。 */
    async retry(): Promise<void> {
      if (lastStableFingerprint) questionFailureCooldowns.delete(lastStableFingerprint)
      lastProcessedFrameHash = null
      await enqueueFrame()
    },

    /** 切换分类时清除题目上下文并废弃旧分类的在途结果。 */
    resetForCategory(): void {
      activeGeneration += 1
      activeRequestController?.abort()
      activeRequestController = null
      stabilizer.reset()
      questionFailureCooldowns.clear()
      lastProcessedFrameHash = null
      lastStableFingerprint = null
      activeFingerprint = null
      activeCategoryId = null
      recognitionStore.setLastCompletedFingerprint(null)
      recognitionStore.setPhase(running ? 'capturing' : 'idle', running ? '等待识别新分类题目' : '')
      matcherStore.clear()
    },
  }
}

/** 使用屏幕捕获、OCR、远程查询、缓存与 Pinia Store 创建生产控制器。 */
export function useRecognitionController(): RecognitionController {
  const configStore = useConfigStore()
  const matcherStore = useMatcherStore()
  const recognitionStore = useRecognitionStore()
  const { captureCurrentFrame } = useScreenCapture()
  const { recognizeFrame } = useOCR()

  return createRecognitionController({
    captureFrame: () => captureCurrentFrame(configStore.config.capture),
    recognizeFrame,
    query: queryRemoteQuestions,
    sleep: async (durationMs) => await new Promise((resolve) => setTimeout(resolve, durationMs)),
    readCache: getRemoteQuestionCache,
    writeCache: putRemoteQuestionCache,
    getCategoryId: () => configStore.config.remoteQuery.categoryId,
    getRequestTimeoutMs: () => configStore.config.remoteQuery.requestTimeoutMs,
    now: () => Date.now(),
    recognitionStore: {
      /** 读取 Pinia 中最近完成的题目指纹。 */
      get lastCompletedFingerprint() {
        return recognitionStore.lastCompletedFingerprint
      },
      /** 同步流程阶段和用户提示。 */
      setPhase(phase, message) {
        recognitionStore.setPhase(phase)
        recognitionStore.setMessage(message)
      },
      /** 同步连续识别运行状态。 */
      setRunning(value) {
        recognitionStore.setRunning(value)
      },
      /** 同步最近完成的题目指纹。 */
      setLastCompletedFingerprint(fingerprint) {
        recognitionStore.setLastCompletedFingerprint(fingerprint)
      },
      /** 同步结果来源和本次求解耗时。 */
      setOutcome(resultSource, durationMs) {
        recognitionStore.resultSource = resultSource
        recognitionStore.durationMs = durationMs
      },
    },
    matcherStore,
  })
}
