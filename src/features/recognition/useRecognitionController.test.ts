import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptureFrame } from '../../types/capture'
import type { RemoteQueryResult } from '../../types/remoteQuestion'
import { createRecognitionController, type RecognitionControllerDependencies } from './useRecognitionController'

/** 生成有明暗文字结构的两道不同题图。 */
function frame(variant = 0): CaptureFrame {
  const data = new Uint8ClampedArray(80 * 24 * 4)
  for (let index = 0; index < data.length; index += 4) {
    const value = ((index / 4 + variant) % 7 < 2 ? 210 : 40)
    data.set([value, value, value, 255], index)
  }
  return { questionImage: { width: 80, height: 24, data } as ImageData, capturedAt: Date.now(), frameHash: String(variant) }
}

/** 创建只以175dt结果为输入的控制器测试环境。 */
function harness(query?: RecognitionControllerDependencies['queryScreenshot']) {
  let currentFrame = frame()
  const presentation = { setPhase: vi.fn(), setRunning: vi.fn(), publishResult: vi.fn(), clearResult: vi.fn(), recordRequest: vi.fn() }
  const queryScreenshot = vi.fn<RecognitionControllerDependencies['queryScreenshot']>(query ?? (async () => ({
    kind: 'success', candidates: [{ question: '题目', answerText: '答案', source: '175dt' }],
  })))
  const controller = createRecognitionController({
    captureFrame: () => currentFrame,
    queryScreenshot,
    getCategoryId: () => '53',
    getRequestTimeoutMs: () => 15000,
    now: () => Date.now(),
    sleep: async duration => await new Promise(resolve => setTimeout(resolve, duration)),
    recognitionStore: presentation,
  })
  controllers.push(controller)
  return { controller, queryScreenshot, presentation, changeFrame: () => { currentFrame = frame(1) } }
}

const controllers: ReturnType<typeof createRecognitionController>[] = []
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
afterEach(() => {
  controllers.splice(0).forEach(controller => controller.stop())
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('175dt截图连续识别', () => {
  it('稳定500毫秒才查询，同一画面持续不变只请求一次', async () => {
    const test = harness()
    test.controller.start()
    await vi.advanceTimersByTimeAsync(499)
    expect(test.queryScreenshot).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(test.queryScreenshot).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10000)
    expect(test.queryScreenshot).toHaveBeenCalledTimes(1)
    expect(test.presentation.publishResult).toHaveBeenCalledTimes(1)
  })

  it('换题即撤下旧答案，新题稳定后仍须遵守两秒查询间隔', async () => {
    const test = harness()
    test.controller.start()
    await vi.advanceTimersByTimeAsync(500)
    test.presentation.clearResult.mockClear()
    test.changeFrame()
    await vi.advanceTimersByTimeAsync(250)
    expect(test.presentation.clearResult).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1499)
    expect(test.queryScreenshot).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(251)
    expect(test.queryScreenshot).toHaveBeenCalledTimes(2)
  })

  it('上传期间仍然监测换题，取消旧请求并丢弃迟到答案', async () => {
    let finish!: (result: RemoteQueryResult) => void
    const test = harness(async () => await new Promise(resolve => { finish = resolve }))
    test.controller.start()
    await vi.advanceTimersByTimeAsync(500)
    const signal = test.queryScreenshot.mock.calls[0]![2].signal!
    test.changeFrame()
    await vi.advanceTimersByTimeAsync(250)
    expect(signal.aborted).toBe(true)
    finish({ kind: 'success', candidates: [{ question: '旧题', answerText: '旧答案', source: '175dt' }] })
    await vi.advanceTimersByTimeAsync(0)
    expect(test.presentation.publishResult).not.toHaveBeenCalled()
  })

  it('停止后任何迟到结果都不能恢复界面答案', async () => {
    let finish!: (result: RemoteQueryResult) => void
    const test = harness(async () => await new Promise(resolve => { finish = resolve }))
    test.controller.start()
    await vi.advanceTimersByTimeAsync(500)
    test.controller.stop()
    expect(test.queryScreenshot.mock.calls[0]![2].signal!.aborted).toBe(true)
    finish({ kind: 'success', candidates: [{ question: '旧题', answerText: '旧答案', source: '175dt' }] })
    await vi.advanceTimersByTimeAsync(0)
    expect(test.presentation.publishResult).not.toHaveBeenCalled()
  })

  it('空结果不会循环刷新接口，手动重试后才允许再次查询', async () => {
    const test = harness(async () => ({ kind: 'empty', candidates: [] }))
    test.controller.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(test.queryScreenshot).toHaveBeenCalledTimes(1)
    await test.controller.retry()
    await vi.advanceTimersByTimeAsync(750)
    expect(test.queryScreenshot).toHaveBeenCalledTimes(2)
  })

  it('手动重试不能绕过175dt限流冷却', async () => {
    const test = harness(async () => ({ kind: 'rateLimited', message: '限流' }))
    test.controller.start()
    await vi.advanceTimersByTimeAsync(500)
    await test.controller.retry()
    await vi.advanceTimersByTimeAsync(59000)
    expect(test.queryScreenshot).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(test.queryScreenshot).toHaveBeenCalledTimes(2)
  })
})
