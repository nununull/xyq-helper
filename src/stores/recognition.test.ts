import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useRecognitionStore } from './recognition'

describe('识别缓存代次', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('缓存清理后递增共享代次并清除已完成题语义', () => {
    const store = useRecognitionStore()
    store.lastCompletedFingerprint = 'old'
    store.lastCompletedQuestion = '旧题干'
    store.resultSource = 'cache'
    store.durationMs = 18
    store.phase = 'showingAnswer'
    store.message = '已从本地缓存找到答案'

    store.invalidateRemoteCache()

    expect(store.cacheGeneration).toBe(1)
    expect(store.lastCompletedFingerprint).toBeNull()
    expect(store.lastCompletedQuestion).toBeNull()
    expect(store.resultSource).toBeNull()
    expect(store.durationMs).toBeNull()
    expect(store.phase).toBe('idle')
    expect(store.message).toBe('')

    store.reset()
    expect(store.cacheGeneration).toBe(1)
  })
})
