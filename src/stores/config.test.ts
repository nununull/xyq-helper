import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../composables/useLocalStorageDB', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}))

describe('配置 Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('选择活动分类时通过 update 持久化克隆后的配置', async () => {
    vi.stubGlobal('window', { devicePixelRatio: 2 })
    const { saveConfig } = await import('../composables/useLocalStorageDB')
    const { useConfigStore } = await import('./config')
    vi.mocked(saveConfig).mockReset().mockResolvedValue(undefined)
    const store = useConfigStore()
    const originalConfig = store.config

    await store.selectActivityCategory('44')

    expect(store.config).not.toBe(originalConfig)
    expect(store.config.remoteQuery.categoryId).toBe('44')
    expect(originalConfig.remoteQuery.categoryId).toBe('')
    expect(saveConfig).toHaveBeenCalledWith(store.config)
  })
})
