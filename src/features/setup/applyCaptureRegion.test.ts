import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { applyQuestionRegion, resolveCaptureConfig } from './applyCaptureRegion'
import { hasValidCaptureRegions } from '../../types/config'

describe('175dt题干框选', () => {
  it('保存题干和原始窗口尺寸，不复用选项框或响应式对象', () => {
    const region = reactive({ x: 10, y: 20, width: 300, height: 80 })
    const sourceSize = reactive({ width: 1024, height: 768 })
    const next = applyQuestionRegion({ remoteQuery: { categoryId: '53' } }, region, sourceSize)
    const capture = resolveCaptureConfig(next, sourceSize)
    expect(hasValidCaptureRegions(capture)).toBe(true)
    expect(capture.questionRegion).toEqual(region)
    expect(capture.questionRegion).not.toBe(region)
    expect(capture.sourceSize).toEqual(sourceSize)
    expect(capture.optionsRegion).toBeNull()
    expect(() => structuredClone(next)).not.toThrow()
  })
  it('按活动和画面尺寸独立保存，且只覆盖当前组合', () => {
    const small = { width: 800, height: 600 }
    const large = { width: 1024, height: 768 }
    const region = { x: 10, y: 20, width: 300, height: 80 }
    const moved = { ...region, x: 100 }
    const initial = applyQuestionRegion({ remoteQuery: { categoryId: '53' } }, region, small)
    const both = applyQuestionRegion(initial, moved, large)
    const other = { ...both, remoteQuery: { ...both.remoteQuery, categoryId: '54' } }
    expect(resolveCaptureConfig(other, small).questionRegion).toBeNull()
    const savedOther = applyQuestionRegion(other, moved, small)
    const restored = { ...savedOther, remoteQuery: both.remoteQuery }
    expect(resolveCaptureConfig(restored, small).questionRegion).toEqual(region)
    expect(resolveCaptureConfig(restored, large).questionRegion).toEqual(moved)
    expect(resolveCaptureConfig(savedOther, small).questionRegion).toEqual(moved)
    expect(resolveCaptureConfig(applyQuestionRegion(restored, moved, small), small).questionRegion).toEqual(moved)
  })
})
