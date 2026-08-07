import { describe, expect, it } from 'vitest'
import { convertPreviewRegionToVideoPixels } from './previewCoordinates'

describe('共享预览坐标换算', () => {
  it('将预览内的 CSS 坐标按实际视频尺寸换算并限制在画面内', () => {
    const result = convertPreviewRegionToVideoPixels(
      { x: 100, y: 50, width: 300, height: 150 },
      { width: 800, height: 450 },
      { width: 1920, height: 1080 },
    )

    expect(result).toEqual({ x: 240, y: 120, width: 720, height: 360 })
  })
})
