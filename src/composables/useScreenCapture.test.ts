import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useScreenCapture } from './useScreenCapture'

describe('屏幕捕获结束监听', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
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
})
