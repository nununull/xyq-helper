import { mergeAppConfig, type AppConfig, type PartialAppConfig } from '../../types/config'
import type { CaptureConfig, CaptureRegion } from '../../types/capture'

/** 同一个活动在不同原始画面尺寸下使用不同的题干框。 */
function regionKey(categoryId: string, { width, height }: NonNullable<CaptureConfig['sourceSize']>): string {
  return `${categoryId}:${width}x${height}`
}

/** 只覆盖当前活动和尺寸的题干框，并清除归属不明的旧全局框。 */
export function applyQuestionRegion(config: PartialAppConfig, questionRegion: CaptureRegion, sourceSize: NonNullable<CaptureConfig['sourceSize']>): AppConfig {
  const next = mergeAppConfig(config)
  next.questionRegions[regionKey(next.remoteQuery.categoryId, sourceSize)] = { ...questionRegion }
  next.capture.questionRegion = null
  next.capture.sourceSize = null
  next.capture.regionCoordinateSpace = null
  return next
}

/** 从保存记录派生本次裁剪配置。 */
export function resolveCaptureConfig(config: AppConfig, sourceSize: CaptureConfig['sourceSize']): CaptureConfig {
  const categoryId = config.remoteQuery.categoryId
  const questionRegion = categoryId && sourceSize
    ? config.questionRegions[regionKey(categoryId, sourceSize)] ?? null
    : null
  return {
    ...config.capture,
    questionRegion,
    sourceSize: questionRegion ? sourceSize : null,
    regionCoordinateSpace: questionRegion ? '175dt-question-v1' : null,
  }
}
