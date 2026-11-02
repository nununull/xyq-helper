import { describe, expect, it } from 'vitest'
import { convertPreviewRegionToVideoPixels, fitVideoToContainer } from './previewCoordinates'

describe('共享预览坐标换算', () => {
  it('宽画面按容器宽度等比缩小，不裁剪内容', () => {
    expect(fitVideoToContainer({ width: 1920, height: 1080 }, { width: 800, height: 600 }))
      .toEqual({ width: 800, height: 450 })
  })

  it('竖屏画面按容器高度缩小，选框仍对应原始像素', () => {
    const preview = fitVideoToContainer({ width: 1080, height: 1920 }, { width: 800, height: 480 })
    expect(preview).toEqual({ width: 270, height: 480 })
    expect(convertPreviewRegionToVideoPixels(
      { x: 27, y: 48, width: 135, height: 240 }, preview, { width: 1080, height: 1920 },
    )).toEqual({ x: 108, y: 192, width: 540, height: 960 })
  })

  it('视频元数据或容器尺寸尚未就绪时不计算无效尺寸', () => {
    expect(fitVideoToContainer({ width: 0, height: 0 }, { width: 800, height: 600 }))
      .toEqual({ width: 0, height: 0 })
    expect(fitVideoToContainer({ width: 1920, height: 1080 }, { width: 0, height: 0 }))
      .toEqual({ width: 0, height: 0 })
  })

  it('将预览内的 CSS 坐标按实际视频尺寸换算并限制在画面内', () => {
    const result = convertPreviewRegionToVideoPixels(
      { x: 100, y: 50, width: 300, height: 150 },
      { width: 800, height: 450 },
      { width: 1920, height: 1080 },
    )

    expect(result).toEqual({ x: 240, y: 120, width: 720, height: 360 })
  })
})
