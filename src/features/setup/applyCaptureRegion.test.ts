import { describe, expect, it } from 'vitest'
import type { AppConfig } from '../../types/config'
import { applyCaptureRegion } from './applyCaptureRegion'

const questionRegion = { x: 10, y: 20, width: 300, height: 80 }
const optionsRegion = { x: 10, y: 120, width: 300, height: 160 }

/** 创建仅残留旧选项区域的历史配置。 */
function createOptionsOnlyConfig(): AppConfig {
  return {
    capture: {
      questionRegion: null,
      optionsRegion,
      devicePixelRatio: 1.25,
      captureFps: 2,
    },
    ocr: { grayscale: true, binarize: true, threshold: 150, scale: 2 },
    matcher: { topK: 5, minConfidence: 0.45 },
    remoteQuery: { categoryId: '', requestTimeoutMs: 1_500 },
    overlay: { opacity: 0.88, autoHideMs: 10_000, fontSize: 'large' },
  }
}

describe('设置向导捕获区域草稿', () => {
  it('保存题干区域时清除历史选项区域并保持输入不变', () => {
    const config = createOptionsOnlyConfig()

    const next = applyCaptureRegion(config, 'question', questionRegion, 2)

    expect(next.capture.questionRegion).toEqual(questionRegion)
    expect(next.capture.optionsRegion).toBeNull()
    expect(config.capture.questionRegion).toBeNull()
    expect(config.capture.optionsRegion).toEqual(optionsRegion)
  })

  it('保存选项区域时保留题干区域并记录当前像素比', () => {
    const withQuestion = applyCaptureRegion(
      createOptionsOnlyConfig(),
      'question',
      questionRegion,
      2,
    )

    const completed = applyCaptureRegion(withQuestion, 'options', optionsRegion, 2)

    expect(completed.capture.questionRegion).toEqual(questionRegion)
    expect(completed.capture.optionsRegion).toEqual(optionsRegion)
    expect(completed.capture.devicePixelRatio).toBe(2)
  })
})
