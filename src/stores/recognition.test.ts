import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useRecognitionStore } from './recognition'

beforeEach(() => setActivePinia(createPinia()))

describe('175dt结果唯一来源', () => {
  it('原样保留候选顺序，换题清空全部答案和耗时', () => {
    const store = useRecognitionStore()
    store.publishResult([{ question: '题目', answerText: '答案', source: '175dt' }], 1000)
    store.recordRequest()
    expect(store.candidates[0]?.answerText).toBe('答案')
    expect(store.requestCount).toBe(1)
    store.clearResult()
    expect(store.candidates).toEqual([])
    expect(store.durationMs).toBeNull()
    expect(store.requestCount).toBe(1)
  })
})
