import type { CaptureConfig, CaptureFrame, CaptureRegion } from '../types/capture'
import { createFrameHash } from '../utils/frameHash'

let mediaStream: MediaStream | null = null
let videoElement: HTMLVideoElement | null = null
let activeVideoTrack: MediaStreamTrack | null = null
const captureEndedListeners = new Set<() => void>()

/** 向全部订阅者广播当前屏幕捕获轨道已经结束。 */
function notifyCaptureEnded(): void {
  captureEndedListeners.forEach((listener) => listener())
}

export function useScreenCapture() {
  /** 请求屏幕共享并绑定本次视频轨道的结束事件。 */
  async function startCapture(): Promise<void> {
    stopCapture()
    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    })
    activeVideoTrack = mediaStream.getVideoTracks()[0] ?? null
    activeVideoTrack?.addEventListener('ended', notifyCaptureEnded)

    videoElement = document.createElement('video')
    videoElement.srcObject = mediaStream
    videoElement.muted = true
    await videoElement.play()
  }

  /** 幂等停止当前屏幕共享并释放媒体引用。 */
  function stopCapture(): void {
    activeVideoTrack?.removeEventListener('ended', notifyCaptureEnded)
    mediaStream?.getTracks().forEach((track) => track.stop())
    mediaStream = null
    videoElement = null
    activeVideoTrack = null
  }

  /** 订阅捕获轨道结束事件，并返回对应的取消订阅函数。 */
  function onCaptureEnded(listener: () => void): () => void {
    captureEndedListeners.add(listener)
    return () => captureEndedListeners.delete(listener)
  }

  /** 按配置区域裁剪当前视频帧。 */
  function captureCurrentFrame(config: CaptureConfig): CaptureFrame | null {
    if (!videoElement || !config.questionRegion || !config.optionsRegion) {
      return null
    }

    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = videoElement.videoWidth
    sourceCanvas.height = videoElement.videoHeight
    const sourceContext = sourceCanvas.getContext('2d')
    if (!sourceContext) {
      return null
    }

    sourceContext.drawImage(videoElement, 0, 0, sourceCanvas.width, sourceCanvas.height)

    const questionImage = cropRegion(sourceContext, config.questionRegion, config.devicePixelRatio)
    const optionsImage = cropRegion(sourceContext, config.optionsRegion, config.devicePixelRatio)

    return {
      questionImage,
      optionsImage,
      capturedAt: Date.now(),
      frameHash: `${createFrameHash(questionImage)}-${createFrameHash(optionsImage)}`,
    }
  }

  return {
    startCapture,
    stopCapture,
    onCaptureEnded,
    captureCurrentFrame,
  }
}

/** 从源画布中裁剪一个经过像素比换算的区域。 */
function cropRegion(
  sourceContext: CanvasRenderingContext2D,
  region: CaptureRegion,
  devicePixelRatio: number,
): ImageData {
  const scale = devicePixelRatio || 1
  return sourceContext.getImageData(
    Math.round(region.x * scale),
    Math.round(region.y * scale),
    Math.round(region.width * scale),
    Math.round(region.height * scale),
  )
}
