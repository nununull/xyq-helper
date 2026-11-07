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

  it('自定义换题阈值会保存，重新合并持久化配置后仍沿用用户选择', async () => {
    const { saveConfig } = await import('../composables/useLocalStorageDB')
    const { useConfigStore } = await import('./config')
    const { mergeAppConfig } = await import('../types/config')
    const store = useConfigStore()
    await store.setChangeThresholdPercent(1.2)
    const saved = vi.mocked(saveConfig).mock.calls.at(-1)![0]
    expect(mergeAppConfig(JSON.parse(JSON.stringify(saved))).capture.changeThresholdPercent).toBe(1.2)
  })
})
