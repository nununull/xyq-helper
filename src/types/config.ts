import type { CaptureConfig } from './capture'

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
  }
}

export const defaultAppConfig: AppConfig = {
  capture: {
    questionRegion: null,
    optionsRegion: null,
    devicePixelRatio: window.devicePixelRatio || 1,
    captureFps: 1,
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
  },
}

type PartialAppConfig = {
  [Key in keyof AppConfig]?: Partial<AppConfig[Key]>
}

/** 将持久化配置与当前默认值按分组深层合并，兼容旧版本缺失字段。 */
export function mergeAppConfig(config: PartialAppConfig | null | undefined): AppConfig {
  return {
    capture: { ...defaultAppConfig.capture, ...config?.capture },
    ocr: { ...defaultAppConfig.ocr, ...config?.ocr },
    matcher: { ...defaultAppConfig.matcher, ...config?.matcher },
    remoteQuery: { ...defaultAppConfig.remoteQuery, ...config?.remoteQuery },
    overlay: { ...defaultAppConfig.overlay, ...config?.overlay },
  }
}
