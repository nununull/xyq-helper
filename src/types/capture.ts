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
  /** 题干框所属共享窗口的原始尺寸，尺寸改变后必须重新框选。 */
  sourceSize?: { width: number; height: number } | null
  /** 新版统一答题区域；存在时优先于旧版双区域配置。 */
  answerRegion?: CaptureRegion | null
  questionRegion: CaptureRegion | null
  optionsRegion: CaptureRegion | null
  regionCoordinateSpace: 'video-pixel-v1' | '175dt-question-v1' | null
  devicePixelRatio: number
  captureFps: number
}

/**
 * 单次裁剪后的捕获帧。
 */
export interface CaptureFrame {
  questionImage: ImageData
  capturedAt: number
  frameHash: string
}

export type CaptureStatus = 'idle' | 'requesting' | 'active' | 'paused' | 'error'
