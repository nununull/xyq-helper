import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { applyQuestionRegion } from './applyCaptureRegion'
import { hasValidCaptureRegions } from '../../types/config'

describe('175dt题干框选', () => {
  it('保存题干和原始窗口尺寸，不复用选项框或响应式对象', () => {
    const region = reactive({ x: 10, y: 20, width: 300, height: 80 })
    const sourceSize = reactive({ width: 1024, height: 768 })
    const next = applyQuestionRegion({ remoteQuery: { categoryId: '53' } }, region, sourceSize)
    expect(hasValidCaptureRegions(next.capture)).toBe(true)
    expect(next.capture.questionRegion).toEqual(region)
    expect(next.capture.questionRegion).not.toBe(region)
    expect(next.capture.sourceSize).toEqual(sourceSize)
    expect(next.capture.optionsRegion).toBeNull()
    expect(() => structuredClone(next)).not.toThrow()
  })
})
