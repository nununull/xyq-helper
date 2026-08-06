import type { CaptureConfig, CaptureFrame, CaptureRegion } from '../types/capture'
import { createFrameHash } from '../utils/frameHash'

let mediaStream: MediaStream | null = null
let videoElement: HTMLVideoElement | null = null
let activeVideoTrack: MediaStreamTrack | null = null
let activeTrackEndedHandler: (() => void) | null = null
let captureGeneration = 0
const captureEndedListeners = new Set<() => void>()

/** 向全部订阅者广播当前屏幕捕获轨道已经结束。 */
function notifyCaptureEnded(): void {
  captureEndedListeners.forEach((listener) => listener())
}

/** 停止指定媒体流的全部轨道。 */
function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop())
}

/** 释放当前捕获资源，并在停止轨道前解除 ended 监听。 */
function releaseActiveCapture(): void {
  activeVideoTrack?.removeEventListener('ended', activeTrackEndedHandler ?? notifyCaptureEnded)
  if (mediaStream) stopStream(mediaStream)
  mediaStream = null
  videoElement = null
  activeVideoTrack = null
  activeTrackEndedHandler = null
}

/** 仅处理仍拥有当前捕获代次的轨道结束事件。 */
function handleTrackEnded(generation: number, stream: MediaStream): void {
  if (generation !== captureGeneration || mediaStream !== stream) return
  captureGeneration += 1
  releaseActiveCapture()
  notifyCaptureEnded()
}

/** 提供具有代次所有权保护的屏幕捕获操作。 */
export function useScreenCapture() {
  /** 请求屏幕共享并绑定本次视频轨道的结束事件。 */
  async function startCapture(): Promise<boolean> {
    const generation = ++captureGeneration
    releaseActiveCapture()
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      })
    } catch (error) {
      if (generation !== captureGeneration) return false
      throw error
    }
    if (generation !== captureGeneration) {
      stopStream(stream)
      return false
    }

    const video = document.createElement('video')
    const videoTrack = stream.getVideoTracks()[0] ?? null
    const endedHandler = () => handleTrackEnded(generation, stream)
    videoTrack?.addEventListener('ended', endedHandler)
    video.srcObject = stream
    video.muted = true
    mediaStream = stream
    videoElement = video
    activeVideoTrack = videoTrack
    activeTrackEndedHandler = endedHandler

    try {
      await video.play()
    } catch (error) {
      if (generation !== captureGeneration || mediaStream !== stream) return false
      captureGeneration += 1
      releaseActiveCapture()
      throw error
    }

    return generation === captureGeneration && mediaStream === stream
  }

  /** 幂等停止当前屏幕共享并释放媒体引用。 */
  function stopCapture(): void {
    captureGeneration += 1
    releaseActiveCapture()
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
