import type { CaptureConfig, CaptureFrame, CaptureRegion } from '../types/capture'
import { createFrameHash } from '../utils/frameHash'

let mediaStream: MediaStream | null = null
let videoElement: HTMLVideoElement | null = null

export function useScreenCapture() {
  async function startCapture(): Promise<void> {
    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    })

    videoElement = document.createElement('video')
    videoElement.srcObject = mediaStream
    videoElement.muted = true
    await videoElement.play()
  }

  function stopCapture(): void {
    mediaStream?.getTracks().forEach((track) => track.stop())
    mediaStream = null
    videoElement = null
  }

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
    captureCurrentFrame,
  }
}

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
