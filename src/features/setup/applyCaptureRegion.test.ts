import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import type { AppConfig, PartialAppConfig } from '../../types/config'

const questionRegion = { x: 10, y: 20, width: 300, height: 80 }
const optionsRegion = { x: 10, y: 120, width: 300, height: 160 }

/** 创建仅残留旧选项区域且缺少新字段的响应式历史配置。 */
function createOptionsOnlyLegacyConfig(): PartialAppConfig {
  return reactive({
    capture: {
      questionRegion: null,
      optionsRegion: { ...optionsRegion },
      devicePixelRatio: 1.25,
      captureFps: 2,
    },
  })
}

/** 创建题干区域已就绪的响应式完整配置。 */
function createNormalConfig(): AppConfig {
  return reactive({
    capture: {
      questionRegion: { ...questionRegion },
      optionsRegion: null,
      devicePixelRatio: 1.25,
      captureFps: 2,
    },
    ocr: { grayscale: true, binarize: true, threshold: 150, scale: 2 },
    matcher: { topK: 5, minConfidence: 0.45 },
    remoteQuery: { categoryId: '44', requestTimeoutMs: 1_500 },
    overlay: { opacity: 0.88, autoHideMs: 10_000, fontSize: 'large' },
  })
}

describe('设置向导捕获区域草稿', () => {
  it('响应式 options-only 旧配置保存题干时补全默认值并清除历史选项', async () => {
    vi.stubGlobal('window', { devicePixelRatio: 2 })
    const { applyCaptureRegion } = await import('./applyCaptureRegion')
    const config = createOptionsOnlyLegacyConfig()

    const next = applyCaptureRegion(config, 'question', questionRegion, 2)

    expect(() => structuredClone(next)).not.toThrow()
    expect(next.remoteQuery).toEqual({ categoryId: '', requestTimeoutMs: 1_500 })
    expect(next.capture.questionRegion).toEqual(questionRegion)
    expect(next.capture.questionRegion).not.toBe(questionRegion)
    expect(next.capture.optionsRegion).toBeNull()
    expect(config.capture!.questionRegion).toBeNull()
    expect(config.capture!.optionsRegion).toEqual(optionsRegion)
  })

  it('响应式完整配置保存选项时复制区域并记录当前像素比', async () => {
    vi.stubGlobal('window', { devicePixelRatio: 2 })
    const { applyCaptureRegion } = await import('./applyCaptureRegion')
    const config = createNormalConfig()
    const originalQuestionRegion = config.capture.questionRegion

    const completed = applyCaptureRegion(config, 'options', optionsRegion, 2)

    expect(() => structuredClone(completed)).not.toThrow()
    expect(completed.capture.questionRegion).toEqual(questionRegion)
    expect(completed.capture.questionRegion).not.toBe(originalQuestionRegion)
    expect(completed.capture.optionsRegion).toEqual(optionsRegion)
    expect(completed.capture.optionsRegion).not.toBe(optionsRegion)
    expect(completed.capture.devicePixelRatio).toBe(2)
    expect(config.capture.optionsRegion).toBeNull()
    expect(config.capture.devicePixelRatio).toBe(1.25)
  })
})
