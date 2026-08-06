import { useOCR } from '../../composables/useOCR'
import {
  getRemoteQuestionCache,
  putRemoteQuestionCache,
} from '../../composables/useLocalStorageDB'
import { useScreenCapture } from '../../composables/useScreenCapture'
import { useCaptureStore } from '../../stores/capture'
import { useConfigStore } from '../../stores/config'
import { useMatcherStore } from '../../stores/matcher'
import { useOCRStore } from '../../stores/ocr'
import { useRecognitionStore } from '../../stores/recognition'
import type { CaptureFrame } from '../../types/capture'
import type { MatchResult } from '../../types/match'
import type { OCRResult } from '../../types/ocr'
import type { ParsedQuestion } from '../../types/question'
import type {
  RecognitionPhase,
  RemoteAmbiguousCandidate,
  RemoteQueryOptions,
  RemoteQueryResult,
  RemoteQuestionCache,
} from '../../types/remoteQuestion'
import { parseQuestion } from '../../utils/parseQuestion'
import {
  cleanRemoteQueryText,
  createQuestionFingerprint,
  findSimilarQuestionEntry,
  selectFallbackKeyword,
  type SimilarQuestionEntry,
} from '../remote-query/queryText'
import {
  inferRemoteAnswer,
  rankRemoteCandidates,
  type RemoteMatchDecision,
} from '../remote-query/remoteCandidateMatcher'
import { queryRemoteQuestions } from '../remote-query/remoteQuestionClient'
import { createQuestionStabilizer } from './questionStabilizer'
import { createRecognitionRuntimeAdapters } from './recognitionRuntimeAdapters'

const POLL_INTERVAL_MS = 500
const QUESTION_FAILURE_COOLDOWN_MS = 10_000
const CATEGORY_RATE_LIMIT_COOLDOWN_MS = 60_000

interface RecognitionStorePort {
  readonly cacheGeneration: number
  readonly lastCompletedFingerprint: string | null
  readonly lastCompletedQuestion: string | null
  /** 同步识别阶段及其用户提示。 */
  setPhase(phase: RecognitionPhase, message: string): void
  /** 同步连续识别是否运行。 */
  setRunning(running: boolean): void
  /** 记录最近完成的题目指纹。 */
  setLastCompletedFingerprint(fingerprint: string | null): void
  /** 记录最近完成的标准化题干。 */
  setLastCompletedQuestion(question: string | null): void
  /** 记录本次答案来源与求解耗时。 */
  setOutcome(resultSource: 'cache' | 'remote', durationMs: number): void
}

interface MatcherStorePort {
  /** 发布或清空当前匹配结果。 */
  setResult(result: MatchResult | null): void
  /** 发布或清空远程歧义候选。 */
  setRemoteCandidates(candidates: RemoteAmbiguousCandidate[]): void
  /** 发布或清空当前匹配错误。 */
  setError(error: string): void
  /** 清空当前匹配上下文。 */
  clear(): void
}

interface OCRPresentationPort {
  /** 发布当前代次已经开始 OCR。 */
  publishStarted(): void
  /** 发布当前代次的 OCR 成功结果。 */
  publishResult(result: OCRResult): void
  /** 发布当前代次的 OCR 失败消息。 */
  publishError(error: string): void
}

interface SolveContext {
  generation: number
  cacheGeneration: number
  requestController: AbortController
  fingerprint: string
  categoryId: string
  normalizedQuestion: string
}

interface StableQuestionSnapshot {
  parsed: ParsedQuestion
  ocrConfidence: number
  frameHash: string
}

type SnapshotRetryKind = 'question' | 'category'

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
  ocrPresentation: OCRPresentationPort
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
    ocrPresentation,
    recognitionStore,
    matcherStore,
  } = dependencies
  const stabilizer = createQuestionStabilizer()
  const questionFailureCooldowns = new Map<string, number>()
  const categoryRateLimitCooldowns = new Map<string, number>()

  let running = false
  let loopPromise: Promise<void> | null = null
  let detectionTail: Promise<void> = Promise.resolve()
  let lifecycleGeneration = 0
  let activeSolveGeneration = 0
  let observedCacheGeneration = recognitionStore.cacheGeneration
  let activeRequestController: AbortController | null = null
  let lastStableFrameHash: string | null = null
  let lastStableQuestion: string | null = null
  let lastStableSnapshot: StableQuestionSnapshot | null = null
  let pendingSnapshotRetry: SnapshotRetryKind | null = null
  let activeFingerprint: string | null = null
  let activeSolveContext: SolveContext | null = null
  let lastCompletedCache: SimilarQuestionEntry<RemoteQuestionCache> | null = null
  const solveContexts = new WeakMap<ParsedQuestion, SolveContext>()

  /** 判断异步结果是否仍属于当前识别代次。 */
  function canPublish(context: SolveContext): boolean {
    return context.generation === activeSolveGeneration
      && context.cacheGeneration === recognitionStore.cacheGeneration
      && context.requestController === activeRequestController
      && !context.requestController.signal.aborted
  }

  /** 中止当前求解并递增求解代次，使迟到结果无法发布。 */
  function invalidateActiveSolve(): void {
    activeSolveGeneration += 1
    activeRequestController?.abort()
    activeRequestController = null
    activeSolveContext = null
  }

  /** 清除帧稳定器和当前题目上下文，下一帧必须重新稳定。 */
  function clearCurrentQuestionContext(): void {
    stabilizer.reset()
    lastStableFrameHash = null
    lastStableQuestion = null
    lastStableSnapshot = null
    pendingSnapshotRetry = null
    activeFingerprint = null
  }

  /** 在共享缓存代次变化时废弃旧 solve 与所有内存快照。 */
  function synchronizeCacheGeneration(): void {
    if (observedCacheGeneration === recognitionStore.cacheGeneration) return
    observedCacheGeneration = recognitionStore.cacheGeneration
    invalidateActiveSolve()
    lastCompletedCache = null
    lastStableFrameHash = null
    lastStableQuestion = null
    lastStableSnapshot = null
    pendingSnapshotRetry = null
    activeFingerprint = null
    matcherStore.clear()
  }

  /** 将当前 OCR 结果保留为待下一帧确认的新题并立即废弃旧求解。 */
  function beginPendingQuestion(): void {
    lastStableFrameHash = null
    lastStableQuestion = null
    lastStableSnapshot = null
    pendingSnapshotRetry = null
    invalidateActiveSolve()
    activeFingerprint = null
    matcherStore.clear()
  }

  /** 清理过期记录后，查找与当前题干足够相似的有效失败冷却。 */
  function findActiveFailureCooldown(
    normalizedQuestion: string,
  ): SimilarQuestionEntry<number> | null {
    const currentTime = now()
    for (const [question, expiresAt] of questionFailureCooldowns) {
      if (expiresAt <= currentTime) questionFailureCooldowns.delete(question)
    }
    return findSimilarQuestionEntry(
      normalizedQuestion,
      Array.from(questionFailureCooldowns, ([question, value]) => ({
        normalizedQuestion: question,
        value,
      })),
    )
  }

  /** 以固定文案发布等待重试状态，并登记对应冷却时间。 */
  function publishFailure(
    result: Exclude<RemoteQueryResult, { kind: 'success' | 'empty' }>,
  ): void {
    const context = activeSolveContext
    if (!context || !canPublish(context)) return
    matcherStore.setRemoteCandidates([])

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
      categoryRateLimitCooldowns.set(context.categoryId, now() + CATEGORY_RATE_LIMIT_COOLDOWN_MS)
      pendingSnapshotRetry = 'category'
    } else {
      questionFailureCooldowns.set(
        context.normalizedQuestion,
        now() + QUESTION_FAILURE_COOLDOWN_MS,
      )
      pendingSnapshotRetry = 'question'
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
    const context = solveContexts.get(parsed)
    if (!context || !canPublish(context)) return
    const inferred = inferRemoteAnswer(cached.answerText, parsed.options)
    const updated = {
      ...cached,
      lastUsedAt: now(),
      hitCount: cached.hitCount + 1,
    }
    await writeCache(updated)
    if (!canPublish(context)) return

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
    recognitionStore.setLastCompletedQuestion(parsed.normalizedQuestion)
    lastCompletedCache = {
      normalizedQuestion: parsed.normalizedQuestion,
      value: updated,
    }
    pendingSnapshotRetry = null
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
    const context = solveContexts.get(parsed)
    if (!context || !canPublish(context)) return
    if (decision.kind === 'rejected' || !decision.best) {
      matcherStore.setRemoteCandidates([])
      questionFailureCooldowns.set(
        parsed.normalizedQuestion,
        now() + QUESTION_FAILURE_COOLDOWN_MS,
      )
      pendingSnapshotRetry = 'question'
      const message = '当前题目未查询到'
      matcherStore.setError(message)
      recognitionStore.setPhase('waitingRetry', message)
      return
    }
    if (decision.kind === 'ambiguous') {
      questionFailureCooldowns.set(
        parsed.normalizedQuestion,
        now() + QUESTION_FAILURE_COOLDOWN_MS,
      )
      pendingSnapshotRetry = 'question'
      const message = '找到多道相似题'
      matcherStore.setRemoteCandidates(decision.candidates.slice(0, 2).map((candidate) => ({
        question: candidate.question,
        answerText: candidate.answerText,
        confidence: candidate.confidence,
      })))
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
    if (!canPublish(context)) return

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
    recognitionStore.setLastCompletedQuestion(parsed.normalizedQuestion)
    lastCompletedCache = {
      normalizedQuestion: parsed.normalizedQuestion,
      value: cacheRecord,
    }
    pendingSnapshotRetry = null
    recognitionStore.setPhase('showingAnswer', warning ?? '已找到远程答案')
  }

  /** 为一个已经稳定的题目执行缓存、远程查询、排序和结果发布。 */
  async function solveStableQuestion(parsed: ParsedQuestion, ocrConfidence: number): Promise<void> {
    const startedAt = performance.now()
    const categoryId = getCategoryId()
    const fingerprint = createQuestionFingerprint(parsed.normalizedQuestion)
    if (!categoryId) return

    activeRequestController?.abort()
    const requestController = new AbortController()
    const context: SolveContext = {
      generation: ++activeSolveGeneration,
      cacheGeneration: recognitionStore.cacheGeneration,
      requestController,
      fingerprint,
      categoryId,
      normalizedQuestion: parsed.normalizedQuestion,
    }
    activeRequestController = requestController
    activeSolveContext = context
    activeFingerprint = fingerprint
    solveContexts.set(parsed, context)

    try {
      recognitionStore.setPhase('cacheLookup', '正在查询本地缓存')
      const cached = await readCache(categoryId, fingerprint)
      if (!canPublish(context)) return
      if (cached) {
        await publishCachedResult(cached, parsed, startedAt)
        return
      }
      const completed = findSimilarQuestionEntry(
        parsed.normalizedQuestion,
        lastCompletedCache ? [lastCompletedCache] : [],
      )
      if (completed) {
        await publishCachedResult(completed.value, parsed, startedAt)
        return
      }
      if (fingerprint === recognitionStore.lastCompletedFingerprint) return

      recognitionStore.setPhase('primaryQuery', '正在查询远程题库')
      const primary = await query(categoryId, cleanRemoteQueryText(parsed.questionText), {
        signal: requestController.signal,
        timeoutMs: getRequestTimeoutMs(),
      })
      if (!canPublish(context)) return
      let candidates = primary.kind === 'success' ? primary.candidates : []

      if (primary.kind === 'empty') {
        const fallback = selectFallbackKeyword(parsed.questionText)
        if (fallback) {
          recognitionStore.setPhase('fallbackQuery', '正在使用关键词重试')
          const secondary = await query(categoryId, fallback, {
            signal: requestController.signal,
            timeoutMs: getRequestTimeoutMs(),
          })
          if (!canPublish(context)) return
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
    } catch (error) {
      if (canPublish(context)) {
        matcherStore.setRemoteCandidates([])
        questionFailureCooldowns.set(
          parsed.normalizedQuestion,
          now() + QUESTION_FAILURE_COOLDOWN_MS,
        )
        pendingSnapshotRetry = 'question'
        const message = error instanceof Error ? error.message : '连续识别发生异常'
        matcherStore.setError(message)
        recognitionStore.setPhase('waitingRetry', message)
      }
    } finally {
      if (context.generation === activeSolveGeneration
        && activeRequestController === requestController) {
        activeRequestController = null
        activeSolveContext = null
      }
    }
  }

  /** 捕获并串行处理一帧，所有异步边界均校验识别代次。 */
  async function processFrame(scheduledGeneration: number): Promise<void> {
    if (scheduledGeneration !== lifecycleGeneration) return
    synchronizeCacheGeneration()
    const captured = await captureFrame()
    if (scheduledGeneration !== lifecycleGeneration || !captured) return
    if (captured.frameHash === lastStableFrameHash) {
      resumeStableSnapshotIfReady()
      return
    }

    matcherStore.setError('')
    recognitionStore.setPhase('capturing', '正在处理新的题目画面')
    recognitionStore.setPhase('recognizing', '正在识别题目文字')
    ocrPresentation.publishStarted()
    let recognized: OCRResult
    try {
      recognized = await recognizeFrame(captured)
    } catch (error) {
      if (scheduledGeneration !== lifecycleGeneration) return
      ocrPresentation.publishError(error instanceof Error ? error.message : 'OCR 识别失败')
      throw error
    }
    if (scheduledGeneration !== lifecycleGeneration) return
    ocrPresentation.publishResult(recognized)

    recognitionStore.setPhase('stabilizing', '正在确认题目稳定性')
    const parsed = parseQuestion(recognized)
    const stability = stabilizer.push(parsed)
    if (stability.kind !== 'stable') {
      beginPendingQuestion()
      return
    }
    const stable = stability.question
    const fingerprint = createQuestionFingerprint(stable.normalizedQuestion)
    if (
      activeFingerprint !== null
      && fingerprint !== activeFingerprint
      && stability.similarity <= 0.95
    ) {
      beginPendingQuestion()
      return
    }

    const ocrConfidence = (recognized.question.confidence + recognized.options.confidence) / 2
    lastStableFrameHash = captured.frameHash
    lastStableQuestion = stable.normalizedQuestion
    lastStableSnapshot = { parsed: stable, ocrConfidence, frameHash: captured.frameHash }
    if (fingerprint !== activeFingerprint) {
      invalidateActiveSolve()
      activeFingerprint = fingerprint
    }
    const activeCooldown = findActiveFailureCooldown(stable.normalizedQuestion)
    if (activeCooldown) {
      pendingSnapshotRetry = 'question'
      recognitionStore.setPhase('waitingRetry', '当前题目暂在失败冷却中')
      return
    }

    const categoryId = getCategoryId()
    if ((categoryRateLimitCooldowns.get(categoryId) ?? 0) > now()) {
      pendingSnapshotRetry = 'category'
      recognitionStore.setPhase('waitingRetry', '当前分类请求过于频繁，请稍后重试')
      return
    }

    if (activeRequestController) return
    pendingSnapshotRetry = null
    void solveStableQuestion(stable, ocrConfidence)
  }

  /** 在静态画面冷却到期后复用最后稳定快照，避免重复 OCR。 */
  function resumeStableSnapshotIfReady(): void {
    const snapshot = lastStableSnapshot
    if (
      !snapshot
      || snapshot.frameHash !== lastStableFrameHash
      || !pendingSnapshotRetry
      || activeRequestController
    ) return

    if (
      pendingSnapshotRetry === 'question'
      && findActiveFailureCooldown(snapshot.parsed.normalizedQuestion)
    ) return

    const categoryId = getCategoryId()
    if (
      pendingSnapshotRetry === 'category'
      && (categoryRateLimitCooldowns.get(categoryId) ?? 0) > now()
    ) return

    pendingSnapshotRetry = null
    void solveStableQuestion(snapshot.parsed, snapshot.ocrConfidence)
  }

  /** 将一次识别帧追加到共享串行队列，避免 OCR 或请求重叠。 */
  function enqueueFrame(): Promise<void> {
    const scheduledGeneration = lifecycleGeneration
    const cycle = detectionTail
      .catch(() => undefined)
      .then(() => processFrame(scheduledGeneration))
    detectionTail = cycle
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
      lifecycleGeneration += 1
      invalidateActiveSolve()
      clearCurrentQuestionContext()
      recognitionStore.setRunning(false)
      matcherStore.setRemoteCandidates([])
      recognitionStore.setPhase('paused', '连续识别已暂停')
    },

    /** 清除当前题目失败冷却并立即串行处理一帧。 */
    async retry(): Promise<void> {
      const retryQuestion = lastStableQuestion
      lifecycleGeneration += 1
      invalidateActiveSolve()
      if (retryQuestion) {
        const cooldown = findActiveFailureCooldown(retryQuestion)
        if (cooldown) questionFailureCooldowns.delete(cooldown.normalizedQuestion)
      }
      clearCurrentQuestionContext()
      matcherStore.setError('')
      await enqueueFrame()
    },

    /** 切换分类时清除题目上下文并废弃旧分类的在途结果。 */
    resetForCategory(): void {
      lifecycleGeneration += 1
      invalidateActiveSolve()
      questionFailureCooldowns.clear()
      clearCurrentQuestionContext()
      recognitionStore.setLastCompletedFingerprint(null)
      recognitionStore.setLastCompletedQuestion(null)
      lastCompletedCache = null
      recognitionStore.setPhase(running ? 'capturing' : 'idle', running ? '等待识别新分类题目' : '')
      matcherStore.clear()
    },
  }
}

/** 使用屏幕捕获、OCR、远程查询、缓存与 Pinia Store 创建生产控制器。 */
export function useRecognitionController(): RecognitionController {
  const captureStore = useCaptureStore()
  const configStore = useConfigStore()
  const matcherStore = useMatcherStore()
  const ocrStore = useOCRStore()
  const recognitionStore = useRecognitionStore()
  const { captureCurrentFrame } = useScreenCapture()
  const { recognizeFrame } = useOCR()
  const runtimeAdapters = createRecognitionRuntimeAdapters({
    captureFrame: () => captureCurrentFrame(configStore.config.capture),
    captureStore,
    ocrStore,
  })

  return createRecognitionController({
    captureFrame: runtimeAdapters.captureFrame,
    recognizeFrame,
    query: queryRemoteQuestions,
    sleep: async (durationMs) => await new Promise((resolve) => setTimeout(resolve, durationMs)),
    readCache: getRemoteQuestionCache,
    writeCache: putRemoteQuestionCache,
    getCategoryId: () => configStore.config.remoteQuery.categoryId,
    getRequestTimeoutMs: () => configStore.config.remoteQuery.requestTimeoutMs,
    now: () => Date.now(),
    ocrPresentation: {
      publishStarted: runtimeAdapters.publishOCRStarted,
      publishResult: runtimeAdapters.publishOCRResult,
      publishError: runtimeAdapters.publishOCRError,
    },
    recognitionStore: {
      /** 读取 Pinia 中的共享缓存代次。 */
      get cacheGeneration() {
        return recognitionStore.cacheGeneration
      },
      /** 读取 Pinia 中最近完成的题目指纹。 */
      get lastCompletedFingerprint() {
        return recognitionStore.lastCompletedFingerprint
      },
      /** 读取 Pinia 中最近完成的标准化题干。 */
      get lastCompletedQuestion() {
        return recognitionStore.lastCompletedQuestion
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
      /** 同步最近完成的标准化题干。 */
      setLastCompletedQuestion(question) {
        recognitionStore.setLastCompletedQuestion(question)
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
