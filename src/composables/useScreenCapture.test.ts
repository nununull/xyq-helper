import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScreenCapture } from './useScreenCapture'

/** 创建带可观测停止方法的模拟视频轨道和媒体流。 */
function createTrackAndStream() {
  const track = new EventTarget() as MediaStreamTrack
  track.stop = vi.fn()
  const stream = {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream
  return { track, stream }
}

/** 为每次屏幕捕获提供可立即播放的模拟视频元素。 */
function stubVideoElements(): void {
  vi.stubGlobal('document', {
    createElement: vi.fn().mockImplementation(() => ({
      play: vi.fn().mockResolvedValue(undefined),
      muted: false,
      srcObject: null,
    })),
  })
}

describe('屏幕捕获结束监听', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useScreenCapture().stopCapture()
  })

  afterEach(() => {
    useScreenCapture().stopCapture()
    vi.unstubAllGlobals()
  })

  it('捕获轨道结束时通知订阅者，取消订阅后不再通知', async () => {
    const track = new EventTarget() as MediaStreamTrack
    track.stop = vi.fn()
    const stream = {
      getVideoTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream
    const play = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', {
      mediaDevices: { getDisplayMedia: vi.fn().mockResolvedValue(stream) },
    })
    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue({ play, muted: false, srcObject: null }),
    })
    const capture = useScreenCapture()
    const listener = vi.fn()
    const unsubscribe = capture.onCaptureEnded(listener)

    await capture.startCapture()
    track.dispatchEvent(new Event('ended'))
    unsubscribe()
    track.dispatchEvent(new Event('ended'))

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('重复停止捕获不会重复停止轨道', async () => {
    const track = new EventTarget() as MediaStreamTrack
    track.stop = vi.fn()
    const stream = {
      getVideoTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream
    vi.stubGlobal('navigator', {
      mediaDevices: { getDisplayMedia: vi.fn().mockResolvedValue(stream) },
    })
    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue({
        play: vi.fn().mockResolvedValue(undefined),
        muted: false,
        srcObject: null,
      }),
    })
    const capture = useScreenCapture()

    await capture.startCapture()
    capture.stopCapture()
    capture.stopCapture()

    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it('两个并发授权乱序完成时只有最新请求可以接管捕获', async () => {
    const first = createTrackAndStream()
    const second = createTrackAndStream()
    let resolveFirst!: (stream: MediaStream) => void
    let resolveSecond!: (stream: MediaStream) => void
    const getDisplayMedia = vi.fn()
      .mockImplementationOnce(async () => await new Promise<MediaStream>((resolve) => {
        resolveFirst = resolve
      }))
      .mockImplementationOnce(async () => await new Promise<MediaStream>((resolve) => {
        resolveSecond = resolve
      }))
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } })
    stubVideoElements()
    const capture = useScreenCapture()

    const firstStart = capture.startCapture()
    const secondStart = capture.startCapture()
    resolveSecond(second.stream)
    await expect(secondStart).resolves.toBe(true)
    resolveFirst(first.stream)
    await expect(firstStart).resolves.toBe(false)

    expect(first.track.stop).toHaveBeenCalledTimes(1)
    expect(second.track.stop).not.toHaveBeenCalled()
  })

  it('停止后迟到的授权流会被关闭且不会接管捕获', async () => {
    const late = createTrackAndStream()
    let resolveCapture!: (stream: MediaStream) => void
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getDisplayMedia: vi.fn().mockImplementation(async () => await new Promise<MediaStream>((resolve) => {
          resolveCapture = resolve
        })),
      },
    })
    stubVideoElements()
    const capture = useScreenCapture()

    const pendingStart = capture.startCapture()
    capture.stopCapture()
    resolveCapture(late.stream)

    await expect(pendingStart).resolves.toBe(false)
    expect(late.track.stop).toHaveBeenCalledTimes(1)
    expect(capture.captureCurrentFrame({
      questionRegion: null,
      optionsRegion: null,
      devicePixelRatio: 1,
      captureFps: 2,
    })).toBeNull()
  })

  it('旧视频播放在新捕获接管后失败时不会破坏新捕获', async () => {
    const first = createTrackAndStream()
    const second = createTrackAndStream()
    let rejectFirstPlay!: (error: Error) => void
    const firstVideo = {
      play: vi.fn().mockImplementation(async () => await new Promise<void>((_resolve, reject) => {
        rejectFirstPlay = reject
      })),
      muted: false,
      srcObject: null,
    }
    const secondVideo = {
      play: vi.fn().mockResolvedValue(undefined),
      muted: false,
      srcObject: null,
    }
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getDisplayMedia: vi.fn()
          .mockResolvedValueOnce(first.stream)
          .mockResolvedValueOnce(second.stream),
      },
    })
    vi.stubGlobal('document', {
      createElement: vi.fn()
        .mockReturnValueOnce(firstVideo)
        .mockReturnValueOnce(secondVideo),
    })
    const capture = useScreenCapture()

    const firstStart = capture.startCapture()
    await vi.waitFor(() => expect(firstVideo.play).toHaveBeenCalled())
    const secondStart = capture.startCapture()
    await expect(secondStart).resolves.toBe(true)
    rejectFirstPlay(new Error('旧视频已停止'))

    await expect(firstStart).resolves.toBe(false)
    expect(first.track.stop).toHaveBeenCalledTimes(1)
    expect(second.track.stop).not.toHaveBeenCalled()
  })

  it('轨道结束会先释放捕获资源，后续停止仍保持幂等', async () => {
    const { track, stream } = createTrackAndStream()
    vi.stubGlobal('navigator', {
      mediaDevices: { getDisplayMedia: vi.fn().mockResolvedValue(stream) },
    })
    stubVideoElements()
    const capture = useScreenCapture()
    const listener = vi.fn(() => {
      expect(capture.captureCurrentFrame({
        questionRegion: null,
        optionsRegion: null,
        devicePixelRatio: 1,
        captureFps: 2,
      })).toBeNull()
    })
    const unsubscribe = capture.onCaptureEnded(listener)

    await capture.startCapture()
    track.dispatchEvent(new Event('ended'))
    capture.stopCapture()
    unsubscribe()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(track.stop).toHaveBeenCalledTimes(1)
  })
})
