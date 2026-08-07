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
