import { STABILITY_MS } from '../../../shared/recognition-policy.mjs'

interface FrameSignature {
  width: number
  height: number
  pixels: Uint8Array
  blank: boolean
}

/** 保留题干原像素的亮度，避免缩小宽题图时漏掉单字或笔画变化。 */
function sampleFrame(image: ImageData): FrameSignature {
  const { width, height } = image
  const pixels = new Uint8Array(width * height)
  let minimum = 255
  let maximum = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const value = Math.round(image.data[index]! * 0.299 + image.data[index + 1]! * 0.587 + image.data[index + 2]! * 0.114)
      pixels[y * width + x] = value
      minimum = Math.min(minimum, value)
      maximum = Math.max(maximum, value)
    }
  }
  return { width: image.width, height: image.height, pixels, blank: maximum - minimum < 18 }
}

/** 忽略压缩、抗锯齿和轻微亮度抖动，保留局部文字变化。 */
function isSameFrame(left: FrameSignature, right: FrameSignature): boolean {
  if (left.width !== right.width || left.height !== right.height) return false
  let changes = 0
  for (let index = 0; index < left.pixels.length; index += 1) {
    if (Math.abs(left.pixels[index]! - right.pixels[index]!) > 24) changes += 1
  }
  return changes <= 2
}

/** 在画面持续稳定500毫秒后放行一次题干，纯色和黑屏始终不放行。 */
export function createFrameMonitor() {
  let current: FrameSignature | null = null
  let stableSince = 0

  /** 比较当前截图与本轮候选画面，累计稳定时间。 */
  function observe(image: ImageData, now: number) {
    const next = sampleFrame(image)
    const changed = !current || !isSameFrame(current, next)
    if (changed) {
      current = next
      stableSince = now
    }
    return { changed, blank: next.blank, stable: !next.blank && now - stableSince >= STABILITY_MS }
  }

  /** 丢弃旧共享窗口的稳定状态。 */
  function reset(): void {
    current = null
    stableSince = 0
  }

  return { observe, reset }
}
