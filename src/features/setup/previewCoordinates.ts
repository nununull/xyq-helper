import type { CaptureRegion } from '../../types/capture'

interface Size {
  width: number
  height: number
}

/** 将预览元素中的矩形换算为共享视频原始像素坐标。 */
export function convertPreviewRegionToVideoPixels(
  region: CaptureRegion,
  preview: Size,
  video: Size,
): CaptureRegion {
  const scaleX = video.width / preview.width
  const scaleY = video.height / preview.height
  const x = Math.max(0, Math.min(preview.width, region.x))
  const y = Math.max(0, Math.min(preview.height, region.y))
  const width = Math.max(0, Math.min(preview.width - x, region.width))
  const height = Math.max(0, Math.min(preview.height - y, region.height))

  return {
    x: Math.round(x * scaleX),
    y: Math.round(y * scaleY),
    width: Math.round(width * scaleX),
    height: Math.round(height * scaleY),
  }
}

/** 将共享视频原始像素区域换算为预览元素中的矩形。 */
export function convertVideoRegionToPreviewPixels(
  region: CaptureRegion,
  video: Size,
  preview: Size,
): CaptureRegion {
  const scaleX = preview.width / video.width
  const scaleY = preview.height / video.height
  const x = Math.max(0, Math.min(video.width, region.x))
  const y = Math.max(0, Math.min(video.height, region.y))
  const width = Math.max(0, Math.min(video.width - x, region.width))
  const height = Math.max(0, Math.min(video.height - y, region.height))

  return {
    x: x * scaleX,
    y: y * scaleY,
    width: width * scaleX,
    height: height * scaleY,
  }
}
