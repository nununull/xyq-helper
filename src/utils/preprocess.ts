import type { AppConfig } from '../types/config'

/**
 * 对截图进行基础预处理，提高游戏小字号文字的 OCR 可读性。
 */
export function preprocessImage(image: ImageData, options: AppConfig['ocr']): ImageData {
  const scaled = scaleImageData(image, Math.max(1, options.scale))
  const data = new Uint8ClampedArray(scaled.data)
  const automaticThreshold = options.binarize ? calculateOtsuThreshold(data) : options.threshold
  const threshold = Math.round(automaticThreshold * 0.75 + options.threshold * 0.25)

  for (let index = 0; index < data.length; index += 4) {
    const gray = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114)
    const value = options.binarize ? (gray >= threshold ? 255 : 0) : gray

    if (options.grayscale || options.binarize) {
      data[index] = value
      data[index + 1] = value
      data[index + 2] = value
    }
  }

  if (options.binarize) normalizeTextPolarity(data)

  return new ImageData(data, scaled.width, scaled.height)
}

/** 使用 Otsu 最大类间方差法计算适合当前游戏画面的自动二值化阈值。 */
function calculateOtsuThreshold(data: Uint8ClampedArray): number {
  const histogram = new Uint32Array(256)
  let totalGray = 0
  const pixelCount = data.length / 4

  for (let index = 0; index < data.length; index += 4) {
    const gray = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114)
    histogram[gray] += 1
    totalGray += gray
  }

  let backgroundCount = 0
  let backgroundGray = 0
  let maximumVariance = -1
  let bestThreshold = 128
  for (let threshold = 0; threshold < histogram.length; threshold += 1) {
    backgroundCount += histogram[threshold]
    if (backgroundCount === 0) continue
    const foregroundCount = pixelCount - backgroundCount
    if (foregroundCount === 0) break

    backgroundGray += threshold * histogram[threshold]
    const backgroundMean = backgroundGray / backgroundCount
    const foregroundMean = (totalGray - backgroundGray) / foregroundCount
    const variance = backgroundCount
      * foregroundCount
      * (backgroundMean - foregroundMean) ** 2
    if (variance > maximumVariance) {
      maximumVariance = variance
      bestThreshold = threshold
    }
  }

  return bestThreshold
}

/** 将深色游戏背景上的亮色文字统一转换为白底黑字，减少 OCR 极性误判。 */
function normalizeTextPolarity(data: Uint8ClampedArray): void {
  let whitePixels = 0
  const pixelCount = data.length / 4
  for (let index = 0; index < data.length; index += 4) {
    if (data[index] >= 128) whitePixels += 1
  }

  if (whitePixels >= pixelCount / 2) return
  for (let index = 0; index < data.length; index += 4) {
    const inverted = 255 - data[index]
    data[index] = inverted
    data[index + 1] = inverted
    data[index + 2] = inverted
  }
}

/** 使用最近邻插值放大像素数据，避免小字号文字边缘被平滑。 */
function scaleImageData(image: ImageData, scale: number): ImageData {
  if (scale === 1) {
    return image
  }

  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = image.width
  sourceCanvas.height = image.height
  const sourceContext = sourceCanvas.getContext('2d')
  if (!sourceContext) {
    return image
  }

  sourceContext.putImageData(image, 0, 0)

  const targetCanvas = document.createElement('canvas')
  targetCanvas.width = image.width * scale
  targetCanvas.height = image.height * scale
  const targetContext = targetCanvas.getContext('2d')
  if (!targetContext) {
    return image
  }

  targetContext.imageSmoothingEnabled = false
  targetContext.drawImage(sourceCanvas, 0, 0, targetCanvas.width, targetCanvas.height)
  return targetContext.getImageData(0, 0, targetCanvas.width, targetCanvas.height)
}
