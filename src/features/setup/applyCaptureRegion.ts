import { mergeAppConfig, type AppConfig, type PartialAppConfig } from '../../types/config'
import type { CaptureRegion } from '../../types/capture'

/** 将共享预览中完成的两个区域写入独立的应用配置。 */
export function applyCaptureRegions(
  config: PartialAppConfig,
  questionRegion: CaptureRegion,
  optionsRegion: CaptureRegion,
): AppConfig {
  const next = mergeAppConfig(config)
  next.capture.questionRegion = { ...questionRegion }
  next.capture.optionsRegion = { ...optionsRegion }
  next.capture.regionCoordinateSpace = 'video-pixel-v1'
  return next
}

/** 将一次框选的完整答题区域写入配置，并停用旧版双区域坐标。 */
export function applyAnswerRegion(
  config: PartialAppConfig,
  answerRegion: CaptureRegion,
): AppConfig {
  const next = mergeAppConfig(config)
  next.capture.answerRegion = { ...answerRegion }
  next.capture.questionRegion = null
  next.capture.optionsRegion = null
  next.capture.regionCoordinateSpace = 'video-pixel-v1'
  return next
}
