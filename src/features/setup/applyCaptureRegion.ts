import { mergeAppConfig, type AppConfig, type PartialAppConfig } from '../../types/config'
import type { CaptureRegion } from '../../types/capture'

/** 保存唯一的175dt题干选框，选项和完整窗口不再参与识别。 */
export function applyQuestionRegion(config: PartialAppConfig, questionRegion: CaptureRegion, sourceSize: { width: number; height: number }): AppConfig {
  const next = mergeAppConfig(config)
  next.capture.questionRegion = { ...questionRegion }
  next.capture.sourceSize = { ...sourceSize }
  next.capture.optionsRegion = null
  next.capture.regionCoordinateSpace = '175dt-question-v1'
  return next
}
