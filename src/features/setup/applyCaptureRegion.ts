import { mergeAppConfig, type AppConfig, type PartialAppConfig } from '../../types/config'
import type { CaptureRegion } from '../../types/capture'

export type CaptureRegionKind = 'question' | 'options'

/** 根据向导步骤生成下一份捕获区域配置草稿。 */
export function applyCaptureRegion(
  config: PartialAppConfig,
  kind: CaptureRegionKind,
  region: CaptureRegion,
  devicePixelRatio: number,
): AppConfig {
  const next = mergeAppConfig(config)

  if (kind === 'question') {
    next.capture.questionRegion = { ...region }
    next.capture.optionsRegion = null
  } else {
    next.capture.optionsRegion = { ...region }
    next.capture.devicePixelRatio = devicePixelRatio
  }

  return next
}
