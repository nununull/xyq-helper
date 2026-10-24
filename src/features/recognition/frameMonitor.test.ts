import { describe, expect, it } from 'vitest'
import { createFrameMonitor } from './frameMonitor'

/** 构造带文字明暗分布的题干图像，避免把纯色测试图当作真实题目。 */
function image(offset = 0): ImageData {
  const data = new Uint8ClampedArray(80 * 24 * 4)
  for (let index = 0; index < data.length; index += 4) {
    const value = (index / 4 % 7 < 2 ? 210 : 40) + offset
    data.set([value, value, value, 255], index)
  }
  return { width: 80, height: 24, data } as ImageData
}

describe('题干画面稳定检测', () => {
  it('稳定满500毫秒后才能请求，小幅亮度抖动不算换题', () => {
    const monitor = createFrameMonitor()
    expect(monitor.observe(image(), 0)).toMatchObject({ changed: true, stable: false })
    expect(monitor.observe(image(5), 250)).toMatchObject({ changed: false, stable: false })
    expect(monitor.observe(image(3), 500)).toMatchObject({ changed: false, stable: true })
  })

  it('局部字符发生变化时重新等待稳定，不沿用上一题答案', () => {
    const monitor = createFrameMonitor()
    monitor.observe(image(), 0)
    monitor.observe(image(), 500)
    const changed = image()
    for (let index = 0; index < 160; index += 4) changed.data[index] = 255 - changed.data[index]!
    expect(monitor.observe(changed, 750)).toMatchObject({ changed: true, stable: false })
    expect(monitor.observe(changed, 1250)).toMatchObject({ changed: false, stable: true })
  })

  it('共享黑屏和纯色背景不触发远程搜索', () => {
    const monitor = createFrameMonitor()
    const blank = { width: 80, height: 24, data: new Uint8ClampedArray(80 * 24 * 4) } as ImageData
    monitor.observe(blank, 0)
    expect(monitor.observe(blank, 1000)).toMatchObject({ blank: true, stable: false })
  })

  it('题干只改一个小字形时仍判定换题', () => {
    const monitor = createFrameMonitor()
    monitor.observe(image(), 0)
    monitor.observe(image(), 500)
    const changed = image()
    for (let pixel = 0; pixel < 6; pixel += 1) changed.data[pixel * 4] = 255 - changed.data[pixel * 4]!
    expect(monitor.observe(changed, 750).changed).toBe(true)
  })

  it('宽题图中的小字变化不会被整图比例或缩放稀释', () => {
    const monitor = createFrameMonitor()
    const data = new Uint8ClampedArray(640 * 80 * 4)
    for (let index = 0; index < data.length; index += 4) data.set([index % 12 ? 40 : 210, 40, 40, 255], index)
    const original = { width: 640, height: 80, data } as ImageData
    monitor.observe(original, 0)
    monitor.observe(original, 500)
    const changed = { ...original, data: data.slice() } as ImageData
    for (let pixel = 1; pixel <= 6; pixel += 1) changed.data[(11 * 640 + pixel) * 4] = 255
    expect(monitor.observe(changed, 750).changed).toBe(true)
  })
})
