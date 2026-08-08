import type { CaptureConfig } from './capture'

export const MIN_CAPTURE_FPS = 1
export const MAX_CAPTURE_FPS = 30

/**
 * 应用级配置，后续设置项都集中在这里持久化。
 */
export interface AppConfig {
  capture: CaptureConfig
  ocr: {
    grayscale: boolean
    binarize: boolean
    threshold: number
    scale: number
  }
  matcher: {
    topK: number
    minConfidence: number
  }
  /** 远程题库查询使用的活动分类与单次请求超时。 */
  remoteQuery: {
    categoryId: string
    requestTimeoutMs: number
  }
  overlay: {
    opacity: number
    autoHideMs: number
    fontSize: 'medium' | 'large' | 'extra-large'
    speechEnabled: boolean
  }
}

export const defaultAppConfig: AppConfig = {
  capture: {
    questionRegion: null,
    optionsRegion: null,
    regionCoordinateSpace: null,
    devicePixelRatio: window.devicePixelRatio || 1,
    captureFps: 2,
  },
  ocr: {
    grayscale: true,
    binarize: true,
    threshold: 150,
    scale: 2,
  },
  matcher: {
    topK: 5,
    minConfidence: 0.45,
  },
  remoteQuery: {
    categoryId: '',
    requestTimeoutMs: 1_500,
  },
  overlay: {
    opacity: 0.88,
    autoHideMs: 10_000,
    fontSize: 'large',
    speechEnabled: false,
  },
}

export type PartialAppConfig = {
  [Key in keyof AppConfig]?: Partial<AppConfig[Key]>
}

/** 将抽帧频率约束到应用支持的整数范围。 */
export function normalizeCaptureFps(value: unknown): number {
  const fps = Number(value)
  if (!Number.isFinite(fps)) return defaultAppConfig.capture.captureFps
  return Math.min(MAX_CAPTURE_FPS, Math.max(MIN_CAPTURE_FPS, Math.round(fps)))
}

/** 将持久化配置与当前默认值按分组深层合并，兼容旧版本缺失字段。 */
export function mergeAppConfig(config: PartialAppConfig | null | undefined): AppConfig {
  const capture = { ...defaultAppConfig.capture, ...config?.capture }
  return {
    capture: {
      ...capture,
      captureFps: normalizeCaptureFps(capture.captureFps),
      ...(capture.answerRegion ? { answerRegion: { ...capture.answerRegion } } : {}),
      questionRegion: capture.questionRegion ? { ...capture.questionRegion } : null,
      optionsRegion: capture.optionsRegion ? { ...capture.optionsRegion } : null,
    },
    ocr: { ...defaultAppConfig.ocr, ...config?.ocr },
    matcher: { ...defaultAppConfig.matcher, ...config?.matcher },
    remoteQuery: { ...defaultAppConfig.remoteQuery, ...config?.remoteQuery },
    overlay: { ...defaultAppConfig.overlay, ...config?.overlay },
  }
}

/** 判断题干和选项区域是否都属于当前支持的视频像素坐标系。 */
export function hasValidCaptureRegions(capture: CaptureConfig): boolean {
  return capture.regionCoordinateSpace === 'video-pixel-v1'
    && (capture.answerRegion !== null && capture.answerRegion !== undefined
      || capture.questionRegion !== null && capture.optionsRegion !== null)
}
