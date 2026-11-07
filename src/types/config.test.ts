import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { defaultAppConfig, hasValidCaptureRegions, mergeAppConfig } from './config'

describe('175dt题干配置迁移', () => {
  it('旧配置默认没有收藏，各次合并的收藏数组互不影响', () => {
    const first = mergeAppConfig({ remoteQuery: { categoryId: '44' } })
    const second = mergeAppConfig(null)
    expect(first.remoteQuery.favoriteCategoryIds).toEqual([])
    first.remoteQuery.favoriteCategoryIds.push('44')
    expect(second.remoteQuery.favoriteCategoryIds).toEqual([])
    expect(defaultAppConfig.remoteQuery.favoriteCategoryIds).toEqual([])
  })

  it('恢复收藏时去重并保留添加顺序，不与原配置共享数组', () => {
    const saved = { remoteQuery: { favoriteCategoryIds: ['44', '15', '44'] } }
    const merged = mergeAppConfig(saved)
    expect(merged.remoteQuery.favoriteCategoryIds).toEqual(['44', '15'])
    merged.remoteQuery.favoriteCategoryIds.push('10')
    expect(saved.remoteQuery.favoriteCategoryIds).toEqual(['44', '15', '44'])
  })

  it('旧的完整答题框和双区域配置不会被当成175dt题干框', () => {
    const migrated = mergeAppConfig({ capture: {
      answerRegion: { x: 1, y: 2, width: 600, height: 400 },
      questionRegion: { x: 1, y: 2, width: 300, height: 80 },
      optionsRegion: { x: 1, y: 100, width: 300, height: 200 },
      regionCoordinateSpace: 'video-pixel-v1',
    } })
    expect(hasValidCaptureRegions(migrated.capture)).toBe(false)
    expect(migrated.capture.questionRegion).toBeNull()
    expect(migrated.capture.optionsRegion).toBeNull()
    expect(migrated.capture.answerRegion).toBeUndefined()
  })

  it('响应式题干框和窗口尺寸保存为互不共享引用的普通数据', () => {
    const source = reactive({ capture: {
      questionRegion: { x: 1, y: 2, width: 300, height: 80 },
      sourceSize: { width: 1024, height: 768 }, regionCoordinateSpace: '175dt-question-v1' as const,
    } })
    const merged = mergeAppConfig(source)
    expect(hasValidCaptureRegions(merged.capture)).toBe(true)
    expect(() => structuredClone(merged)).not.toThrow()
    expect(merged.capture.questionRegion).not.toBe(source.capture.questionRegion)
    expect(merged.capture.sourceSize).not.toBe(source.capture.sourceSize)
    expect(merged.remoteQuery.requestTimeoutMs).toBe(15000)
    expect(defaultAppConfig.capture.captureFps).toBe(4)
  })
})
