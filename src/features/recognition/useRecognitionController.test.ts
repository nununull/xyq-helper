import { describe, expect, it, vi } from 'vitest'
import type { CaptureFrame } from '../../types/capture'
import type { MatchResult } from '../../types/match'
import type { OCRResult } from '../../types/ocr'
import type { RecognitionPhase, RemoteQuestionCache, RemoteQueryResult } from '../../types/remoteQuestion'
import { createQuestionFingerprint } from '../remote-query/queryText'
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
const longQuestionText = '中国古代文学发展历史上被称为诗鬼并且留下许多脍炙人口著名诗篇传世作品的唐代诗人究竟是谁？'
const noisyLongQuestionText = longQuestionText.replace('留下', '留卞')
const similarOldQuestion = '中国古代文学历史上被后世尊称为诗鬼的唐代诗人究竟是谁？'
const similarNewQuestion = '中国古代文学历史上被后世尊称为诗圣的唐代诗人究竟是谁？'

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
function ocrResult(
  text = questionText,
  optionsText = 'A. 李白 B. 杜甫 C. 李贺 D. 白居易',
): OCRResult {
  return {
    question: { text, confidence: 0.96 },
    options: { text: optionsText, confidence: 0.94 },
    durationMs: 10,
  }
}

/** 构造一个可命中且答案可映射到本次选项的远程结果。 */
function successfulQuery(question = questionText, answerText = '李贺'): RemoteQueryResult {
  return {
    kind: 'success',
    candidates: [{ question, answerText, source: '175dt' }],
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
  ocrPresentation: {
    publishStarted: ReturnType<typeof vi.fn>
    publishResult: ReturnType<typeof vi.fn>
    publishError: ReturnType<typeof vi.fn>
  }
  matcher: {
    result: MatchResult | null
    remoteCandidates: Array<{ question: string; answerText: string; confidence: number }>
    error: string
  }
  recognition: {
    phase: RecognitionPhase
    message: string
    running: boolean
    lastCompletedFingerprint: string | null
    lastCompletedQuestion: string | null
    cacheGeneration: number
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
  writeCache?: RecognitionControllerDependencies['writeCache']
  recognizeFrame?: RecognitionControllerDependencies['recognizeFrame']
  now?: () => number
} = {}): Harness {
  const frames = [...(options.frames ?? [])]
  const sleepResolvers: Array<() => void> = []
  const matcher = {
    result: null as MatchResult | null,
    remoteCandidates: [] as Array<{ question: string; answerText: string; confidence: number }>,
    error: '',
  }
  const recognition = {
    phase: 'idle' as RecognitionPhase,
    message: '',
    running: false,
    lastCompletedFingerprint: null as string | null,
    lastCompletedQuestion: null as string | null,
    cacheGeneration: 0,
    resultSource: null as 'cache' | 'remote' | null,
    durationMs: null as number | null,
  }
  const captureFrame = vi.fn<RecognitionControllerDependencies['captureFrame']>(
    () => frames.shift() ?? null,
  )
  const recognizeFrame = vi.fn<RecognitionControllerDependencies['recognizeFrame']>(
    options.recognizeFrame ?? (async () => ocrResult()),
  )
  const query = vi.fn<RecognitionControllerDependencies['query']>(
    options.query ?? (async () => successfulQuery()),
  )
  const readCache = vi.fn<RecognitionControllerDependencies['readCache']>(
    options.readCache ?? (async () => undefined),
  )
  const writeCache = vi.fn<RecognitionControllerDependencies['writeCache']>(
    options.writeCache ?? (async () => undefined),
  )
  const ocrPresentation = {
    publishStarted: vi.fn(),
    publishResult: vi.fn(),
    publishError: vi.fn(),
  }

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
    ocrPresentation,
    recognitionStore: {
      /** 读取测试状态中的最近完成指纹。 */
      get lastCompletedFingerprint() {
        return recognition.lastCompletedFingerprint
      },
      /** 读取测试状态中的最近完成题干。 */
      get lastCompletedQuestion() {
        return recognition.lastCompletedQuestion
      },
      /** 读取测试状态中的缓存代次。 */
      get cacheGeneration() {
        return recognition.cacheGeneration
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
      /** 记录测试状态中的完成题干。 */
      setLastCompletedQuestion(question) {
        recognition.lastCompletedQuestion = question
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
        matcher.remoteCandidates = []
        matcher.error = ''
      },
      /** 记录测试状态中的远程歧义候选。 */
      setRemoteCandidates(candidates) {
        matcher.remoteCandidates = candidates
      },
      /** 记录测试状态中的匹配错误。 */
      setError(error) {
        matcher.error = error
      },
      /** 清空测试状态中的匹配上下文。 */
      clear() {
        matcher.result = null
        matcher.remoteCandidates = []
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
    ocrPresentation,
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
  it('stop 后迟到的 OCR 成功结果不会发布到展示 Store', async () => {
    let resolveOCR!: (result: OCRResult) => void
    const harness = createHarness({
      frames: [frame('pending')],
      recognizeFrame: async () => await new Promise<OCRResult>((resolve) => {
        resolveOCR = resolve
      }),
    })

    harness.controller.start()
    await vi.waitFor(() => expect(harness.recognizeFrame).toHaveBeenCalledTimes(1))
    harness.controller.stop()
    resolveOCR(ocrResult())
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(harness.ocrPresentation.publishStarted).toHaveBeenCalledTimes(1)
    expect(harness.ocrPresentation.publishResult).not.toHaveBeenCalled()
    expect(harness.ocrPresentation.publishError).not.toHaveBeenCalled()
  })

  it('reset 后迟到的 OCR 失败不会发布到展示 Store', async () => {
    let rejectOCR!: (error: Error) => void
    const harness = createHarness({
      frames: [frame('pending')],
      recognizeFrame: async () => await new Promise<OCRResult>((_resolve, reject) => {
        rejectOCR = reject
      }),
    })

    harness.controller.start()
    await vi.waitFor(() => expect(harness.recognizeFrame).toHaveBeenCalledTimes(1))
    harness.controller.resetForCategory()
    rejectOCR(new Error('迟到 OCR 错误'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    harness.controller.stop()

    expect(harness.ocrPresentation.publishStarted).toHaveBeenCalledTimes(1)
    expect(harness.ocrPresentation.publishResult).not.toHaveBeenCalled()
    expect(harness.ocrPresentation.publishError).not.toHaveBeenCalled()
  })

  it('相同 hash 的静态画面会完成两帧稳定且只查询一次', async () => {
    const harness = createHarness({ frames: [frame('same'), frame('same'), frame('same')] })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.query).toHaveBeenCalledTimes(1))
    await advanceFrame(harness, 3)
    harness.controller.stop()

    expect(harness.recognizeFrame).toHaveBeenCalledTimes(2)
    expect(harness.query).toHaveBeenCalledTimes(1)
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

  it('缓存 generation 变化后 stop/restart 同题不复用或写回旧内存快照', async () => {
    const harness = createHarness({
      frames: [frame('old-one'), frame('old-two'), frame('new-one'), frame('new-two')],
      query: async () => successfulQuery(),
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.writeCache).toHaveBeenCalledTimes(1))
    harness.controller.stop()
    harness.releaseNextSleep()
    await new Promise((resolve) => setTimeout(resolve, 0))

    harness.recognition.cacheGeneration += 1
    harness.recognition.lastCompletedFingerprint = null
    harness.recognition.lastCompletedQuestion = null
    harness.matcher.result = null
    harness.controller.start()
    await waitForCapturedFrames(harness, 3)
    await advanceFrame(harness, 4)
    await vi.waitFor(() => expect(harness.query).toHaveBeenCalledTimes(2))
    harness.controller.stop()

    expect(harness.writeCache).toHaveBeenCalledTimes(2)
    expect(harness.writeCache.mock.calls[1]?.[0].hitCount).toBe(1)
  })

  it('缓存清理时尚未完成的旧 solve 成功不得迟到写回', async () => {
    let resolveQuery!: (result: RemoteQueryResult) => void
    const harness = createHarness({
      frames: [frame('one'), frame('two')],
      query: async () => await new Promise<RemoteQueryResult>((resolve) => {
        resolveQuery = resolve
      }),
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.query).toHaveBeenCalledTimes(1))

    harness.recognition.cacheGeneration += 1
    harness.recognition.lastCompletedFingerprint = null
    harness.recognition.lastCompletedQuestion = null
    harness.matcher.result = null
    resolveQuery(successfulQuery())
    await new Promise((resolve) => setTimeout(resolve, 0))
    harness.controller.stop()

    expect(harness.writeCache).not.toHaveBeenCalled()
    expect(harness.matcher.result).toBeNull()
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
      frames: [frame('one'), frame('two'), frame('two')],
      query: async () => ({ kind: 'timeout', message: '远程题库响应超时' }),
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.recognition.phase).toBe('waitingRetry'))
    await advanceFrame(harness, 3)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(harness.query).toHaveBeenCalledTimes(1)
    expect(harness.matcher.error).toBe('远程题库响应超时')
    expect(harness.recognition.phase).toBe('waitingRetry')
    harness.controller.stop()
  })

  it('主查询和降级查询均为空时显示未查询到文案', async () => {
    const harness = createHarness({
      frames: [frame('one'), frame('two')],
      query: async () => ({ kind: 'empty', candidates: [] }),
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.recognition.phase).toBe('waitingRetry'))
    harness.controller.stop()

    expect(harness.matcher.error).toBe('当前题目未查询到')
  })

  it('候选结果歧义时保存前两条展示候选且不伪装为确定答案', async () => {
    const harness = createHarness({
      frames: [frame('one'), frame('two')],
      query: async () => ({
        kind: 'success',
        candidates: [
          { question: questionText, answerText: '李贺', source: '175dt' },
          { question: questionText, answerText: '李贺', source: '175dt' },
        ],
      }),
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.recognition.phase).toBe('waitingRetry'))

    expect(harness.matcher.error).toBe('找到多道相似题')
    expect(harness.matcher.result).toBeNull()
    expect(harness.matcher.remoteCandidates).toEqual([
      expect.objectContaining({ question: questionText, answerText: '李贺' }),
      expect.objectContaining({ question: questionText, answerText: '李贺' }),
    ])
    expect(harness.matcher.remoteCandidates[0]?.confidence).toBeGreaterThan(0)

    harness.controller.stop()
    expect(harness.matcher.remoteCandidates).toEqual([])
  })

  it('歧义候选会在新题开始时清空并由确定答案维持为空', async () => {
    const newQuestion = '中国历史上被称为“诗圣”的唐代诗人是谁？'
    const harness = createHarness({
      frames: [frame('old-one'), frame('old-two'), frame('new-one'), frame('new-two')],
      recognizeFrame: async (captured) => ocrResult(
        captured.frameHash.startsWith('new') ? newQuestion : questionText,
      ),
      query: vi.fn()
        .mockResolvedValueOnce({
          kind: 'success',
          candidates: [
            { question: questionText, answerText: '李贺', source: '175dt' },
            { question: questionText, answerText: '李贺', source: '175dt' },
          ],
        })
        .mockResolvedValueOnce(successfulQuery(newQuestion, '杜甫')),
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.matcher.remoteCandidates).toHaveLength(2))
    await advanceFrame(harness, 3)
    expect(harness.matcher.remoteCandidates).toEqual([])
    await advanceFrame(harness, 4)
    await vi.waitFor(() => expect(harness.matcher.result?.answerText).toBe('杜甫'))

    expect(harness.matcher.remoteCandidates).toEqual([])
    harness.controller.stop()
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

  it('已完成题干出现一字 OCR 波动时复用答案并按新选项重新推导字母', async () => {
    const harness = createHarness({
      frames: [frame('one'), frame('two'), frame('three')],
      recognizeFrame: async (captured) => ocrResult(
        captured.frameHash === 'three' ? noisyLongQuestionText : longQuestionText,
        captured.frameHash === 'three'
          ? 'A. 李贺 B. 李白 C. 杜甫 D. 白居易'
          : 'A. 李白 B. 杜甫 C. 李贺 D. 白居易',
      ),
      query: async () => successfulQuery(longQuestionText),
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.matcher.result?.answer).toBe('C'))
    await advanceFrame(harness, 3)
    await vi.waitFor(() => expect(harness.matcher.result?.answer).toBe('A'))
    harness.controller.stop()

    expect(harness.query).toHaveBeenCalledTimes(1)
  })

  it('失败冷却会拦截相似度大于 0.95 的一字 OCR 波动题干', async () => {
    const harness = createHarness({
      frames: [frame('one'), frame('two'), frame('three')],
      recognizeFrame: async (captured) => ocrResult(
        captured.frameHash === 'three' ? noisyLongQuestionText : longQuestionText,
      ),
      query: async () => ({ kind: 'timeout', message: '远程题库响应超时' }),
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.recognition.phase).toBe('waitingRetry'))
    await advanceFrame(harness, 3)
    await new Promise((resolve) => setTimeout(resolve, 0))
    harness.controller.stop()

    expect(harness.query).toHaveBeenCalledTimes(1)
  })

  it('retry 会绕过当前题目的失败冷却并立即重试', async () => {
    let now = 1_000
    const harness = createHarness({
      frames: [frame('one'), frame('two'), frame('three'), frame('four'), frame('five')],
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
    await advanceFrame(harness, 5)
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

  it('静态相同 hash 在题目冷却到期后复用稳定快照自动查询且不额外 OCR', async () => {
    let now = 1_000
    const harness = createHarness({
      frames: [frame('same'), frame('same'), frame('same'), frame('same')],
      now: () => now,
      query: vi.fn()
        .mockResolvedValueOnce({ kind: 'timeout', message: '远程题库响应超时' })
        .mockResolvedValueOnce(successfulQuery()),
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.recognition.phase).toBe('waitingRetry'))

    now += 9_999
    await advanceFrame(harness, 3)
    expect(harness.query).toHaveBeenCalledTimes(1)

    now += 2
    await advanceFrame(harness, 4)
    await vi.waitFor(() => expect(harness.query).toHaveBeenCalledTimes(2))
    harness.controller.stop()

    expect(harness.recognizeFrame).toHaveBeenCalledTimes(2)
    expect(harness.matcher.result?.answerText).toBe('李贺')
  })

  it('静态相同 hash 在分类限流冷却到期后复用稳定快照自动查询且不额外 OCR', async () => {
    let now = 1_000
    const harness = createHarness({
      frames: [frame('same'), frame('same'), frame('same'), frame('same')],
      now: () => now,
      query: vi.fn()
        .mockResolvedValueOnce({ kind: 'rateLimited', message: '接口暂时拒绝请求' })
        .mockResolvedValueOnce(successfulQuery()),
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.recognition.phase).toBe('waitingRetry'))

    now += 59_999
    await advanceFrame(harness, 3)
    expect(harness.query).toHaveBeenCalledTimes(1)

    now += 2
    await advanceFrame(harness, 4)
    await vi.waitFor(() => expect(harness.query).toHaveBeenCalledTimes(2))
    harness.controller.stop()

    expect(harness.recognizeFrame).toHaveBeenCalledTimes(2)
    expect(harness.matcher.result?.answerText).toBe('李贺')
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

  it('旧题请求期间会继续识别，并由两帧稳定的新题中止旧请求', async () => {
    const newQuestion = '被称为“诗圣”的唐代诗人是谁？'
    let resolveOldQuery!: (result: RemoteQueryResult) => void
    let oldSignal: AbortSignal | undefined
    const harness = createHarness({
      frames: [frame('old-one'), frame('old-two'), frame('new-one'), frame('new-two')],
      recognizeFrame: async (captured) => ocrResult(
        captured.frameHash.startsWith('new') ? newQuestion : questionText,
      ),
      query: vi.fn()
        .mockImplementationOnce(async (_categoryId, _queryText, options) => {
          oldSignal = options.signal
          return await new Promise<RemoteQueryResult>((resolve) => {
            resolveOldQuery = resolve
          })
        })
        .mockResolvedValueOnce(successfulQuery(newQuestion, '杜甫')),
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.query).toHaveBeenCalledTimes(1))
    await advanceFrame(harness, 3)
    expect(harness.query).toHaveBeenCalledTimes(1)
    await advanceFrame(harness, 4)
    await vi.waitFor(() => expect(harness.query).toHaveBeenCalledTimes(2))

    resolveOldQuery(successfulQuery())
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(oldSignal?.aborted).toBe(true)
    expect(harness.matcher.result).toMatchObject({ answerText: '杜甫', matchedQuestion: newQuestion })
    expect(harness.matcher.result?.matchedQuestion).not.toBe(questionText)
    harness.controller.stop()
  })

  it('新题第一帧会立即清空旧答案并阻止旧请求迟到发布', async () => {
    const newQuestion = '中国历史上被称为“诗圣”的唐代诗人是谁？'
    let resolveOldQuery!: (result: RemoteQueryResult) => void
    let oldSignal: AbortSignal | undefined
    const harness = createHarness({
      frames: [frame('old-one'), frame('old-two'), frame('new-one')],
      recognizeFrame: async (captured) => ocrResult(
        captured.frameHash === 'new-one' ? newQuestion : questionText,
      ),
      query: async (_categoryId, _queryText, options) => {
        oldSignal = options.signal
        return await new Promise<RemoteQueryResult>((resolve) => {
          resolveOldQuery = resolve
        })
      },
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.query).toHaveBeenCalledTimes(1))
    harness.matcher.result = {
      questionId: 'old',
      answer: 'C',
      answerText: '李贺',
      confidence: 0.98,
      matchedQuestion: questionText,
      source: '175dt',
      candidates: [],
    }

    await advanceFrame(harness, 3)

    expect(oldSignal?.aborted).toBe(true)
    expect(harness.matcher.result).toBeNull()
    resolveOldQuery(successfulQuery())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(harness.matcher.result).toBeNull()
    harness.controller.stop()
  })

  it('旧答案显示后新题最终查询为空时仍保持答案为空', async () => {
    const newQuestion = '中国历史上被称为“诗圣”的唐代诗人是谁？'
    const harness = createHarness({
      frames: [frame('old-one'), frame('old-two'), frame('new-one'), frame('new-two')],
      recognizeFrame: async (captured) => ocrResult(
        captured.frameHash.startsWith('new') ? newQuestion : questionText,
      ),
      query: vi.fn()
        .mockResolvedValueOnce(successfulQuery())
        .mockResolvedValue({ kind: 'empty', candidates: [] }),
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.matcher.result?.answerText).toBe('李贺'))
    await advanceFrame(harness, 3)
    expect(harness.matcher.result).toBeNull()
    await advanceFrame(harness, 4)
    await vi.waitFor(() => expect(harness.recognition.phase).toBe('waitingRetry'))

    expect(harness.matcher.result).toBeNull()
    harness.controller.stop()
  })

  it('0.90–0.95 相似新题首帧立即清旧并取消旧 solve，第二帧才查询', async () => {
    let resolveOldQuery!: (result: RemoteQueryResult) => void
    let oldSignal: AbortSignal | undefined
    const harness = createHarness({
      frames: [frame('old-one'), frame('old-two'), frame('new-one'), frame('new-two')],
      recognizeFrame: async (captured) => ocrResult(
        captured.frameHash.startsWith('new') ? similarNewQuestion : similarOldQuestion,
      ),
      query: vi.fn()
        .mockImplementationOnce(async (_categoryId, _queryText, options) => {
          oldSignal = options.signal
          return await new Promise<RemoteQueryResult>((resolve) => {
            resolveOldQuery = resolve
          })
        })
        .mockResolvedValueOnce({ kind: 'timeout', message: '远程题库响应超时' }),
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.query).toHaveBeenCalledTimes(1))
    harness.matcher.result = {
      questionId: 'old',
      answer: 'C',
      answerText: '李贺',
      confidence: 0.98,
      matchedQuestion: similarOldQuestion,
      source: '175dt',
      candidates: [],
    }

    await advanceFrame(harness, 3)
    expect(oldSignal?.aborted).toBe(true)
    expect(harness.query).toHaveBeenCalledTimes(1)
    expect(harness.matcher.result).toBeNull()

    await advanceFrame(harness, 4)
    await vi.waitFor(() => expect(harness.query).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(harness.recognition.phase).toBe('waitingRetry'))
    resolveOldQuery(successfulQuery(similarOldQuestion))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(harness.matcher.result).toBeNull()
    harness.controller.stop()
  })

  it('切换到已完成题目时仍会立即中止旧题请求', async () => {
    const completedQuestion = '被称为“诗圣”的唐代诗人是谁？'
    let resolveOldQuery!: (result: RemoteQueryResult) => void
    let oldSignal: AbortSignal | undefined
    const harness = createHarness({
      frames: [frame('old-one'), frame('old-two'), frame('done-one'), frame('done-two')],
      recognizeFrame: async (captured) => ocrResult(
        captured.frameHash.startsWith('done') ? completedQuestion : questionText,
      ),
      query: async (_categoryId, _queryText, options) => {
        oldSignal = options.signal
        return await new Promise<RemoteQueryResult>((resolve) => {
          resolveOldQuery = resolve
        })
      },
    })
    harness.recognition.lastCompletedFingerprint = createQuestionFingerprint(completedQuestion)

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.query).toHaveBeenCalledTimes(1))
    await advanceFrame(harness, 3)
    await advanceFrame(harness, 4)

    expect(oldSignal?.aborted).toBe(true)
    expect(harness.query).toHaveBeenCalledTimes(1)
    resolveOldQuery(successfulQuery())
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(harness.matcher.result).toBeNull()
    harness.controller.stop()
  })

  it('切换到冷却题目时仍会立即中止旧题请求', async () => {
    const cooledQuestion = '被称为“诗圣”的唐代诗人是谁？'
    let resolveOldQuery!: (result: RemoteQueryResult) => void
    let oldSignal: AbortSignal | undefined
    const harness = createHarness({
      frames: [
        frame('cool-one'), frame('cool-two'),
        frame('old-one'), frame('old-two'),
        frame('cool-three'), frame('cool-four'),
      ],
      recognizeFrame: async (captured) => ocrResult(
        captured.frameHash.startsWith('cool') ? cooledQuestion : questionText,
      ),
      query: vi.fn()
        .mockResolvedValueOnce({ kind: 'timeout', message: '远程题库响应超时' })
        .mockImplementationOnce(async (_categoryId, _queryText, options) => {
          oldSignal = options.signal
          return await new Promise<RemoteQueryResult>((resolve) => {
            resolveOldQuery = resolve
          })
        }),
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.recognition.phase).toBe('waitingRetry'))
    await advanceFrame(harness, 3)
    await advanceFrame(harness, 4)
    await vi.waitFor(() => expect(harness.query).toHaveBeenCalledTimes(2))
    await advanceFrame(harness, 5)
    await advanceFrame(harness, 6)

    expect(oldSignal?.aborted).toBe(true)
    expect(harness.query).toHaveBeenCalledTimes(2)
    resolveOldQuery(successfulQuery())
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(harness.matcher.result).toBeNull()
    harness.controller.stop()
  })

  it('已完成题目选项重排时从缓存重新推导答案字母且不重复远程查询', async () => {
    let stored: RemoteQuestionCache | undefined
    const harness = createHarness({
      frames: [frame('one'), frame('two'), frame('three'), frame('four')],
      recognizeFrame: async (captured) => ocrResult(
        questionText,
        captured.frameHash === 'one' || captured.frameHash === 'two'
          ? 'A. 李白 B. 杜甫 C. 李贺 D. 白居易'
          : 'A. 李贺 B. 李白 C. 杜甫 D. 白居易',
      ),
      readCache: async () => stored,
      writeCache: async (record) => {
        stored = record
      },
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.matcher.result?.answer).toBe('C'))
    await advanceFrame(harness, 3)
    await vi.waitFor(() => expect(harness.matcher.result?.answer).toBe('A'))
    await advanceFrame(harness, 4)
    await vi.waitFor(() => expect(harness.readCache).toHaveBeenCalledTimes(3))
    harness.controller.stop()

    expect(harness.readCache).toHaveBeenCalledTimes(3)
    expect(harness.query).toHaveBeenCalledTimes(1)
    expect(harness.matcher.result).toMatchObject({ answer: 'A', resultSource: 'cache' })
  })

  it('retry 会优先中止待决请求，使旧失败无法阻止新查询', async () => {
    let resolveOldQuery!: (result: RemoteQueryResult) => void
    let oldSignal: AbortSignal | undefined
    const harness = createHarness({
      frames: [frame('old-one'), frame('old-two'), frame('retry-one'), frame('retry-two')],
      query: vi.fn()
        .mockImplementationOnce(async (_categoryId, _queryText, options) => {
          oldSignal = options.signal
          return await new Promise<RemoteQueryResult>((resolve) => {
            resolveOldQuery = resolve
          })
        })
        .mockResolvedValueOnce(successfulQuery()),
    })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await advanceFrame(harness, 2)
    await vi.waitFor(() => expect(harness.query).toHaveBeenCalledTimes(1))

    await harness.controller.retry()
    expect(oldSignal?.aborted).toBe(true)
    expect(harness.query).toHaveBeenCalledTimes(1)
    resolveOldQuery({ kind: 'timeout', message: '远程题库响应超时' })
    await advanceFrame(harness, 4)
    await vi.waitFor(() => expect(harness.query).toHaveBeenCalledTimes(2))
    harness.controller.stop()

    expect(harness.matcher.result?.resultSource).toBe('remote')
    expect(harness.matcher.error).toBe('')
  })

  it('stop 后重新启动时首帧仍需重新进入稳定流程', async () => {
    const harness = createHarness({ frames: [frame('one'), frame('two')] })

    harness.controller.start()
    await waitForCapturedFrames(harness, 1)
    await new Promise((resolve) => setTimeout(resolve, 0))
    harness.controller.stop()
    harness.releaseNextSleep()
    await new Promise((resolve) => setTimeout(resolve, 0))

    harness.controller.start()
    await waitForCapturedFrames(harness, 2)
    await new Promise((resolve) => setTimeout(resolve, 0))
    harness.controller.stop()

    expect(harness.recognizeFrame).toHaveBeenCalledTimes(2)
    expect(harness.query).not.toHaveBeenCalled()
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
