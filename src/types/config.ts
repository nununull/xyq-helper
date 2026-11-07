import type { CaptureConfig, CaptureRegion } from './capture'
import { CAPTURE_INTERVAL_MS, CLIENT_TIMEOUT_MS, DEFAULT_CHANGE_THRESHOLD_PERCENT } from '../../shared/recognition-policy.mjs'

export const MIN_CAPTURE_FPS = 1
export const MAX_CAPTURE_FPS = 30

/**
 * 应用级配置，后续设置项都集中在这里持久化。
 */
export interface AppConfig {
  capture: CaptureConfig
  /** 按活动和原始画面尺寸保存的题干框。 */
  questionRegions: Record<string, CaptureRegion>
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
  questionRegions: {},
  capture: {
    questionRegion: null,
    optionsRegion: null,
    regionCoordinateSpace: null,
    devicePixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
    captureFps: 1_000 / CAPTURE_INTERVAL_MS,
    changeThresholdPercent: DEFAULT_CHANGE_THRESHOLD_PERCENT,
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
    requestTimeoutMs: CLIENT_TIMEOUT_MS,
  },
  overlay: {
    opacity: 0.88,
    autoHideMs: 10_000,
    fontSize: 'large',
    speechEnabled: false,
  },
}

export type PartialAppConfig = {
  [Key in keyof AppConfig]?: Key extends 'questionRegions' ? AppConfig[Key] : Partial<AppConfig[Key]>
}

/** 将用户选择的换题变化阈值限制在0至5%，避免无效配置关闭检测。 */
export function normalizeChangeThresholdPercent(value: unknown): number {
  const threshold = Number(value)
  return Number.isFinite(threshold) ? Math.min(5, Math.max(0, threshold)) : DEFAULT_CHANGE_THRESHOLD_PERCENT
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
  const calibrated = capture.regionCoordinateSpace === '175dt-question-v1'
  return {
    questionRegions: Object.fromEntries(Object.entries(config?.questionRegions ?? {}).map(([key, region]) => [key, { ...region }])),
    capture: {
      devicePixelRatio: capture.devicePixelRatio,
      captureFps: normalizeCaptureFps(capture.captureFps),
      changeThresholdPercent: normalizeChangeThresholdPercent(capture.changeThresholdPercent),
      regionCoordinateSpace: calibrated ? '175dt-question-v1' : null,
      questionRegion: calibrated && capture.questionRegion ? { ...capture.questionRegion } : null,
      optionsRegion: null,
      sourceSize: calibrated && capture.sourceSize ? { ...capture.sourceSize } : null,
    },
    ocr: { ...defaultAppConfig.ocr, ...config?.ocr },
    matcher: { ...defaultAppConfig.matcher, ...config?.matcher },
    remoteQuery: { ...defaultAppConfig.remoteQuery, ...config?.remoteQuery, requestTimeoutMs: CLIENT_TIMEOUT_MS },
    overlay: { ...defaultAppConfig.overlay, ...config?.overlay },
  }
}

/** 只接受175dt题干选框，旧版完整窗口坐标需要重新框选。 */
export function hasValidCaptureRegions(capture: CaptureConfig): boolean {
  return capture.regionCoordinateSpace === '175dt-question-v1' && Boolean(capture.questionRegion && capture.sourceSize)
}
