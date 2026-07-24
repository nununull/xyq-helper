/**
 * 屏幕上的矩形区域，坐标基于捕获画面的 CSS 像素。
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
  questionRegion: CaptureRegion | null
  optionsRegion: CaptureRegion | null
  devicePixelRatio: number
  captureFps: number
}

/**
 * 单次裁剪后的捕获帧。
 */
export interface CaptureFrame {
  questionImage: ImageData
  optionsImage: ImageData
  capturedAt: number
  frameHash: string
}

export type CaptureStatus = 'idle' | 'requesting' | 'active' | 'paused' | 'error'
