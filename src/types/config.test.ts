import { describe, expect, it, vi } from 'vitest'

describe('应用配置迁移', () => {
  it('旧配置缺少远程查询字段时补充默认值并保留已有嵌套值', async () => {
    vi.stubGlobal('window', { devicePixelRatio: 2 })
    const { mergeAppConfig } = await import('./config')
    const legacyConfig = {
      capture: {
        questionRegion: { x: 1, y: 2, width: 3, height: 4 },
        optionsRegion: null,
        devicePixelRatio: 3,
        captureFps: 2,
      },
      ocr: { grayscale: false, binarize: false, threshold: 123, scale: 4 },
      matcher: { topK: 9, minConfidence: 0.66 },
      overlay: { opacity: 0.5, autoHideMs: 2_000, fontSize: 'extra-large' as const },
    }

    const merged = mergeAppConfig(legacyConfig)

    expect(merged.remoteQuery).toEqual({ categoryId: '', requestTimeoutMs: 1_500 })
    expect(merged.capture).toEqual(legacyConfig.capture)
    expect(merged.ocr).toEqual(legacyConfig.ocr)
    expect(merged.matcher).toEqual(legacyConfig.matcher)
    expect(merged.overlay).toEqual(legacyConfig.overlay)
  })
})
