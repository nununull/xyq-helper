import type { AppConfig } from '../../types/config'
import type { CaptureRegion } from '../../types/capture'

export type CaptureRegionKind = 'question' | 'options'

/** 根据向导步骤生成下一份捕获区域配置草稿。 */
export function applyCaptureRegion(
  config: AppConfig,
  kind: CaptureRegionKind,
  region: CaptureRegion,
  devicePixelRatio: number,
): AppConfig {
  const capture = {
    ...config.capture,
    questionRegion: config.capture.questionRegion
      ? { ...config.capture.questionRegion }
      : null,
    optionsRegion: config.capture.optionsRegion
      ? { ...config.capture.optionsRegion }
      : null,
  }

  if (kind === 'question') {
    capture.questionRegion = { ...region }
    capture.optionsRegion = null
  } else {
    capture.optionsRegion = { ...region }
    capture.devicePixelRatio = devicePixelRatio
  }

  return {
    capture,
    ocr: { ...config.ocr },
    matcher: { ...config.matcher },
    remoteQuery: { ...config.remoteQuery },
    overlay: { ...config.overlay },
  }
}
