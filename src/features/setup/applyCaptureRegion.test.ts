import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import type { PartialAppConfig } from '../../types/config'

const questionRegion = { x: 10, y: 20, width: 300, height: 80 }
const optionsRegion = { x: 10, y: 120, width: 300, height: 160 }

describe('共享预览捕获区域配置', () => {
  it('一次保存两个视频像素区域并补全旧配置默认值', async () => {
    vi.stubGlobal('window', { devicePixelRatio: 2 })
    const { applyCaptureRegions } = await import('./applyCaptureRegion')
    const config: PartialAppConfig = reactive({
      remoteQuery: { categoryId: '44' },
    })

    const next = applyCaptureRegions(config, questionRegion, optionsRegion)

    expect(() => structuredClone(next)).not.toThrow()
    expect(next.remoteQuery).toEqual({ categoryId: '44', requestTimeoutMs: 1_500 })
    expect(next.capture.questionRegion).toEqual(questionRegion)
    expect(next.capture.questionRegion).not.toBe(questionRegion)
    expect(next.capture.optionsRegion).toEqual(optionsRegion)
    expect(next.capture.optionsRegion).not.toBe(optionsRegion)
    expect(next.capture.regionCoordinateSpace).toBe('video-pixel-v1')
  })
})
