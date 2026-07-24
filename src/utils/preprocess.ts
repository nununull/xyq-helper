import type { AppConfig } from '../types/config'

/**
 * 对截图进行基础预处理，提高游戏小字号文字的 OCR 可读性。
 */
export function preprocessImage(image: ImageData, options: AppConfig['ocr']): ImageData {
  const scaled = scaleImageData(image, Math.max(1, options.scale))
  const data = new Uint8ClampedArray(scaled.data)

  for (let index = 0; index < data.length; index += 4) {
    const gray = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114)
    const value = options.binarize ? (gray >= options.threshold ? 255 : 0) : gray

    if (options.grayscale || options.binarize) {
      data[index] = value
      data[index + 1] = value
      data[index + 2] = value
    }
  }

  return new ImageData(data, scaled.width, scaled.height)
}

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
