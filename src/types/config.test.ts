import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

describe('应用配置迁移', () => {
  it('新安装默认以每秒两帧持续捕获', async () => {
    vi.stubGlobal('window', { devicePixelRatio: 2 })
    const { defaultAppConfig } = await import('./config')

    expect(defaultAppConfig.capture.captureFps).toBe(2)
  })

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

  it('响应式默认配置可合并为能安全克隆的独立普通配置', async () => {
    vi.stubGlobal('window', { devicePixelRatio: 2 })
    const { defaultAppConfig, mergeAppConfig } = await import('./config')
    const reactiveConfig = reactive(defaultAppConfig)

    const merged = mergeAppConfig(reactiveConfig)

    expect(() => structuredClone(merged)).not.toThrow()
    expect(merged.capture).not.toBe(reactiveConfig.capture)
    expect(merged.remoteQuery).not.toBe(reactiveConfig.remoteQuery)
  })

  it('响应式旧配置的捕获区域在合并后不共享嵌套引用', async () => {
    vi.stubGlobal('window', { devicePixelRatio: 2 })
    const { mergeAppConfig } = await import('./config')
    const reactiveLegacyConfig = reactive({
      capture: {
        questionRegion: { x: 1, y: 2, width: 300, height: 80 },
        optionsRegion: { x: 1, y: 100, width: 300, height: 160 },
        devicePixelRatio: 2,
        captureFps: 2,
      },
    })

    const merged = mergeAppConfig(reactiveLegacyConfig)

    expect(() => structuredClone(merged)).not.toThrow()
    expect(merged.capture.questionRegion).not.toBe(reactiveLegacyConfig.capture.questionRegion)
    expect(merged.capture.optionsRegion).not.toBe(reactiveLegacyConfig.capture.optionsRegion)
    merged.capture.questionRegion!.x = 99
    expect(reactiveLegacyConfig.capture.questionRegion.x).toBe(1)
  })
})
