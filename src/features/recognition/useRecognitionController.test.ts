import { describe, expect, it, vi } from 'vitest'
import type { CaptureFrame } from '../../types/capture'
import type { MatchResult } from '../../types/match'
import type { OCRResult } from '../../types/ocr'
import type { RecognitionPhase, RemoteQuestionCache, RemoteQueryResult } from '../../types/remoteQuestion'
import { createRecognitionController, type RecognitionControllerDependencies } from './useRecognitionController'

vi.mock('../../composables/useLocalStorageDB', () => ({
  getRemoteQuestionCache: vi.fn(),
  putRemoteQuestionCache: vi.fn(),
}))
vi.mock('../../composables/useOCR', () => ({ useOCR: vi.fn() }))
vi.mock('../../composables/useScreenCapture', () => ({ useScreenCapture: vi.fn() }))
vi.mock('../../stores/config', () => ({ useConfigStore: vi.fn() }))
vi.mock('../../stores/matcher', () => ({ useMatcherStore: vi.fn() }))
vi.mock('../../stores/recognition', () => ({ useRecognitionStore: vi.fn() }))

const questionText = '被称为“诗鬼”的唐代诗人是谁？'

/** 构造只携带控制器所需字段的捕获帧。 */
function frame(frameHash: string): CaptureFrame {
  return {
    questionImage: {} as ImageData,
    optionsImage: {} as ImageData,
    capturedAt: 1,
    frameHash,
  }
}

/** 构造能够稳定解析为同一题目的 OCR 结果。 */
function ocrResult(): OCRResult {
  return {
    question: { text: questionText, confidence: 0.96 },
    options: { text: 'A. 李白 B. 杜甫 C. 李贺 D. 白居易', confidence: 0.94 },
    durationMs: 10,
  }
}

/** 构造一个可命中且答案可映射到本次选项的远程结果。 */
function successfulQuery(): RemoteQueryResult {
  return {
    kind: 'success',
    candidates: [{ question: questionText, answerText: '李贺', source: '175dt' }],
  }
}

/** 构造同一题目的本地远程缓存记录。 */
function cachedQuestion(): RemoteQuestionCache {
  return {
    id: 'category:fingerprint',
    categoryId: 'category',
    questionFingerprint: 'fingerprint',
    recognizedQuestion: questionText,
    matchedQuestion: questionText,
    answerText: '李贺',
    source: '175dt',
    matchConfidence: 0.98,
    createdAt: 100,
    lastUsedAt: 100,
    hitCount: 1,
  }
}

interface Harness {
  controller: ReturnType<typeof createRecognitionController>
  captureFrame: ReturnType<typeof vi.fn<RecognitionControllerDependencies['captureFrame']>>
  recognizeFrame: ReturnType<typeof vi.fn<RecognitionControllerDependencies['recognizeFrame']>>
  query: ReturnType<typeof vi.fn<RecognitionControllerDependencies['query']>>
  readCache: ReturnType<typeof vi.fn<RecognitionControllerDependencies['readCache']>>
  writeCache: ReturnType<typeof vi.fn<RecognitionControllerDependencies['writeCache']>>
  matcher: { result: MatchResult | null; error: string }
  recognition: {
    phase: RecognitionPhase
    message: string
    running: boolean
    lastCompletedFingerprint: string | null
    resultSource: 'cache' | 'remote' | null
    durationMs: number | null
  }
  /** 放行一个由测试控制的轮询等待。 */
  releaseNextSleep(): void
}

/** 创建依赖完全可控的控制器测试环境。 */
function createHarness(options: {
  frames?: CaptureFrame[]
  query?: RecognitionControllerDependencies['query']
  readCache?: RecognitionControllerDependencies['readCache']
  now?: () => number
} = {}): Harness {
  const frames = [...(options.frames ?? [])]
  const sleepResolvers: Array<() => void> = []
  const matcher = { result: null as MatchResult | null, error: '' }
  const recognition = {
    phase: 'idle' as RecognitionPhase,
    message: '',
    running: false,
    lastCompletedFingerprint: null as string | null,
    resultSource: null as 'cache' | 'remote' | null,
    durationMs: null as number | null,
  }
  const captureFrame = vi.fn<RecognitionControllerDependencies['captureFrame']>(
    () => frames.shift() ?? null,
  )
  const recognizeFrame = vi.fn<RecognitionControllerDependencies['recognizeFrame']>(
    async () => ocrResult(),
  )
  const query = vi.fn<RecognitionControllerDependencies['query']>(
    options.query ?? (async () => successfulQuery()),
  )
  const readCache = vi.fn<RecognitionControllerDependencies['readCache']>(
    options.readCache ?? (async () => undefined),
  )
  const writeCache = vi.fn<RecognitionControllerDependencies['writeCache']>(async () => undefined)

  const controller = createRecognitionController({
    captureFrame,
    recognizeFrame,
    query,
    sleep: async () => await new Promise<void>((resolve) => sleepResolvers.push(resolve)),
    readCache,
    writeCache,
    getCategoryId: () => 'category',
    getRequestTimeoutMs: () => 1_500,
    now: options.now ?? (() => 1_000),
    recognitionStore: {
      /** 读取测试状态中的最近完成指纹。 */
      get lastCompletedFingerprint() {
        return recognition.lastCompletedFingerprint
      },
      /** 记录测试状态中的阶段和提示。 */
      setPhase(phase, message) {
        recognition.phase = phase
        recognition.message = message
      },
      /** 记录测试状态中的运行标记。 */
      setRunning(running) {
        recognition.running = running
      },
      /** 记录测试状态中的完成指纹。 */
      setLastCompletedFingerprint(fingerprint) {
        recognition.lastCompletedFingerprint = fingerprint
      },
      /** 记录测试状态中的答案来源和耗时。 */
      setOutcome(resultSource, durationMs) {
        recognition.resultSource = resultSource
        recognition.durationMs = durationMs
      },
    },
    matcherStore: {
      /** 记录测试状态中的匹配结果。 */
      setResult(result) {
        matcher.result = result
        matcher.error = ''
      },
      /** 记录测试状态中的匹配错误。 */
      setError(error) {
        matcher.error = error
      },
      /** 清空测试状态中的匹配上下文。 */
      clear() {
        matcher.result = null
        matcher.error = ''
      },
    },
  })

  return {
    controller,
    captureFrame,
    recognizeFrame,
    query,
    readCache,
    writeCache,
    matcher,
    recognition,
    /** 放行一个由测试控制的轮询等待。 */
    releaseNextSleep() {
      const resolve = sleepResolvers.shift()
      if (!resolve) throw new Error('当前没有等待中的轮询间隔')
      resolve()
    },
  }
}

/** 等待异步轮询完成当前一帧并进入休眠。 */
async function waitForCapturedFrames(harness: Harness, count: number): Promise<void> {
  await vi.waitFor(() => expect(harness.captureFrame).toHaveBeenCalledTimes(count))
}

/** 放行一次轮询间隔并等待下一帧完成。 */
async function advanceFrame(harness: Harness, expectedCount: number): Promise<void> {
  harness.releaseNextSleep()
  await waitForCapturedFrames(harness, expectedCount)
}

describe('串行连续识别控制器', () => {
  it('相同帧指纹会跳过 OCR', async () => {
    const harness = createHarness({ frames: [frame('same'), frame('same')] })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    harness.controller.stop()

    expect(harness.recognizeFrame).toHaveBeenCalledTimes(1)
    expect(harness.query).not.toHaveBeenCalled()
  })

  it('连续两帧稳定题目只触发一次查询', async () => {
    const harness = createHarness({ frames: [frame('one'), frame('two')] })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.query).toHaveBeenCalledTimes(1))
    harness.controller.stop()

    expect(harness.matcher.result?.answer).toBe('C')
  })

  it('缓存命中时不发起任何远程查询并刷新缓存统计', async () => {
    const cached = cachedQuestion()
    const harness = createHarness({
      frames: [frame('one'), frame('two')],
      readCache: async () => cached,
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.writeCache).toHaveBeenCalledTimes(1))
    harness.controller.stop()

    expect(harness.query).not.toHaveBeenCalled()
    expect(harness.writeCache).toHaveBeenCalledWith(expect.objectContaining({ hitCount: 2 }))
    expect(harness.matcher.result).toMatchObject({ answer: 'C', resultSource: 'cache' })
  })

  it('主查询为空时只使用一个降级关键词查询一次', async () => {
    const harness = createHarness({
      frames: [frame('one'), frame('two')],
      query: vi.fn()
        .mockResolvedValueOnce({ kind: 'empty', candidates: [] })
        .mockResolvedValueOnce(successfulQuery()),
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.query).toHaveBeenCalledTimes(2))
    harness.controller.stop()

    expect(harness.query.mock.calls[1]?.[1]).toBe('诗鬼')
  })

  it('主查询超时后不会执行降级查询', async () => {
    const harness = createHarness({
      frames: [frame('one'), frame('two')],
      query: async () => ({ kind: 'timeout', message: '远程题库响应超时' }),
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.recognition.phase).toBe('waitingRetry'))
    harness.controller.stop()

    expect(harness.query).toHaveBeenCalledTimes(1)
  })

  it('已完成的题目指纹不会再次查询', async () => {
    const harness = createHarness({ frames: [frame('one'), frame('two'), frame('three')] })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.query).toHaveBeenCalledTimes(1))
    await advanceFrame(harness, 3)
    harness.controller.stop()

    expect(harness.query).toHaveBeenCalledTimes(1)
  })

  it('retry 会绕过当前题目的失败冷却并立即重试', async () => {
    let now = 1_000
    const harness = createHarness({
      frames: [frame('one'), frame('two'), frame('three'), frame('four')],
      now: () => now,
      query: vi.fn()
        .mockResolvedValueOnce({ kind: 'timeout', message: '远程题库响应超时' })
        .mockResolvedValueOnce(successfulQuery()),
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.query).toHaveBeenCalledTimes(1))

    now += 1_000
    await advanceFrame(harness, 3)
    expect(harness.query).toHaveBeenCalledTimes(1)

    await harness.controller.retry()
    harness.controller.stop()

    expect(harness.query).toHaveBeenCalledTimes(2)
    expect(harness.matcher.result?.resultSource).toBe('remote')
  })

  it('限流失败会对当前分类冷却六十秒', async () => {
    let now = 1_000
    const harness = createHarness({
      frames: [frame('one'), frame('two'), frame('three'), frame('four')],
      now: () => now,
      query: vi.fn()
        .mockResolvedValueOnce({ kind: 'rateLimited', message: '接口暂时拒绝请求' })
        .mockResolvedValueOnce(successfulQuery()),
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.query).toHaveBeenCalledTimes(1))

    now += 59_999
    await advanceFrame(harness, 3)
    expect(harness.query).toHaveBeenCalledTimes(1)

    now += 2
    await advanceFrame(harness, 4)
    await vi.waitFor(() => expect(harness.query).toHaveBeenCalledTimes(2))
    harness.controller.stop()
  })

  it('stop 会中止活动请求并阻止迟到结果更新状态', async () => {
    let resolveQuery!: (result: RemoteQueryResult) => void
    let requestSignal: AbortSignal | undefined
    let queryCalls = 0
    const harness = createHarness({
      frames: [frame('one'), frame('two'), frame('three')],
      query: async (_categoryId, _queryText, options) => {
        queryCalls += 1
        if (queryCalls > 1) return successfulQuery()
        requestSignal = options.signal
        return await new Promise<RemoteQueryResult>((resolve) => {
          resolveQuery = resolve
        })
      },
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(requestSignal).toBeDefined())

    const queuedRetry = harness.controller.retry()
    harness.controller.stop()
    resolveQuery(successfulQuery())
    await queuedRetry
    await vi.waitFor(() => expect(requestSignal?.aborted).toBe(true))

    expect(harness.query).toHaveBeenCalledTimes(1)
    expect(harness.matcher.result).toBeNull()
    expect(harness.recognition.lastCompletedFingerprint).toBeNull()
    expect(harness.recognition.running).toBe(false)
  })

  it('停止后的控制器可以重新启动新的轮询循环', async () => {
    const harness = createHarness({ frames: [frame('one'), frame('two')] })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    harness.controller.stop()
    harness.releaseNextSleep()
    await new Promise((resolve) => setTimeout(resolve, 0))

    harness.controller.start()
    await waitForCapturedFrames(harness, 2)
    harness.controller.stop()

    expect(harness.captureFrame).toHaveBeenCalledTimes(2)
  })
})
