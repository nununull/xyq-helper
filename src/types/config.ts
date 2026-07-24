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
  overlay: {
    opacity: 0.88,
    autoHideMs: 10_000,
    fontSize: 'large',
  },
}
