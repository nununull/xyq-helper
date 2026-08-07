/**
 * 屏幕上的矩形区域，坐标基于共享视频的原始像素。
 */
export interface CaptureRegion {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 捕获模块的用户配置。
 */
export interface CaptureConfig {
  /** 新版统一答题区域；存在时优先于旧版双区域配置。 */
  answerRegion?: CaptureRegion | null
  questionRegion: CaptureRegion | null
  optionsRegion: CaptureRegion | null
  regionCoordinateSpace: 'video-pixel-v1' | null
  devicePixelRatio: number
  captureFps: number
}

/**
 * 单次裁剪后的捕获帧。
 */
interface CaptureFrameBase {
  capturedAt: number
  frameHash: string
}

/** 单次统一答题区域捕获帧。 */
export interface UnifiedCaptureFrame extends CaptureFrameBase {
  answerImage: ImageData
  questionImage?: never
  optionsImage?: never
}

/** 兼容旧配置的题干、选项双区域捕获帧。 */
export interface SplitCaptureFrame extends CaptureFrameBase {
  questionImage: ImageData
  optionsImage: ImageData
  answerImage?: never
}

export type CaptureFrame = UnifiedCaptureFrame | SplitCaptureFrame

export type CaptureStatus = 'idle' | 'requesting' | 'active' | 'paused' | 'error'
