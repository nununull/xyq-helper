import type { CaptureConfig, CaptureFrame, CaptureRegion } from '../types/capture'
import { createFrameHash } from '../utils/frameHash'

let mediaStream: MediaStream | null = null
let videoElement: HTMLVideoElement | null = null
let activeVideoTrack: MediaStreamTrack | null = null
let activeTrackEndedHandler: (() => void) | null = null
let captureGeneration = 0
const captureEndedListeners = new Set<() => void>()

interface CaptureSurface {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
}

let questionSurface: CaptureSurface | null = null

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
  questionSurface = null
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

  /** 返回当前仍然有效的共享流，供预览组件绑定视频元素。 */
  function getActiveStream(): MediaStream | null {
    return mediaStream
  }

  /** 按配置区域裁剪当前视频帧。 */
  function captureCurrentFrame(config: CaptureConfig): CaptureFrame | null {
    if (!videoElement) return null

    if (!config.questionRegion || config.regionCoordinateSpace !== '175dt-question-v1') return null
    const region = config.questionRegion
    if (config.sourceSize && (config.sourceSize.width !== videoElement.videoWidth || config.sourceSize.height !== videoElement.videoHeight)) {
      throw new Error('共享窗口尺寸已变化，请重新框选题干区域')
    }
    if (region.x < 0 || region.y < 0 || region.x + region.width > videoElement.videoWidth || region.y + region.height > videoElement.videoHeight) {
      throw new Error('共享窗口尺寸已变化，请重新校准题干区域')
    }

    questionSurface = prepareCaptureSurface(questionSurface, config.questionRegion)
    if (!questionSurface) return null

    const questionImage = captureRegion(videoElement, questionSurface, config.questionRegion)

    return {
      questionImage,
      capturedAt: Date.now(),
      frameHash: createFrameHash(questionImage),
    }
  }

  return {
    startCapture,
    stopCapture,
    onCaptureEnded,
    getActiveStream,
    captureCurrentFrame,
  }
}

/** 创建或调整可复用的区域画布，避免连续抽帧反复分配大块内存。 */
function prepareCaptureSurface(
  surface: CaptureSurface | null,
  region: CaptureRegion,
): CaptureSurface | null {
  const width = Math.max(1, Math.round(region.width))
  const height = Math.max(1, Math.round(region.height))
  if (!surface) {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    surface = { canvas, context }
  }
  if (surface.canvas.width !== width) surface.canvas.width = width
  if (surface.canvas.height !== height) surface.canvas.height = height
  return surface
}

/** 从共享视频直接裁剪目标区域，跳过整张游戏画面的中间画布。 */
function captureRegion(
  source: HTMLVideoElement,
  surface: CaptureSurface,
  region: CaptureRegion,
): ImageData {
  const { canvas, context } = surface
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.drawImage(
    source,
    Math.round(region.x),
    Math.round(region.y),
    canvas.width,
    canvas.height,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  return context.getImageData(0, 0, canvas.width, canvas.height)
}
