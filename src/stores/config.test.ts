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

  it('收藏按添加顺序保存，重新加载后可取消且不改变当前活动', async () => {
    const { loadConfig, saveConfig } = await import('../composables/useLocalStorageDB')
    const { useConfigStore } = await import('./config')
    vi.mocked(saveConfig).mockReset().mockResolvedValue(undefined)
    const store = useConfigStore()
    await store.selectActivityCategory('44')

    await store.toggleActivityCategoryFavorite('44')
    await store.toggleActivityCategoryFavorite('15')
    const saved = JSON.parse(JSON.stringify(vi.mocked(saveConfig).mock.calls.at(-1)![0]))
    expect(saved.remoteQuery.favoriteCategoryIds).toEqual(['44', '15'])

    vi.mocked(loadConfig).mockResolvedValue(saved)
    setActivePinia(createPinia())
    const reloaded = useConfigStore()
    await reloaded.load()
    expect(reloaded.config.remoteQuery.favoriteCategoryIds).toEqual(['44', '15'])
    await reloaded.toggleActivityCategoryFavorite('44')
    expect(reloaded.config.remoteQuery.favoriteCategoryIds).toEqual(['15'])
    expect(reloaded.config.remoteQuery.categoryId).toBe('44')
    expect(vi.mocked(saveConfig).mock.calls.at(-1)![0].remoteQuery.favoriteCategoryIds).toEqual(['15'])
  })

  it('收藏保存失败时保留原收藏，并向界面抛出错误', async () => {
    const { saveConfig } = await import('../composables/useLocalStorageDB')
    const { useConfigStore } = await import('./config')
    vi.mocked(saveConfig).mockReset().mockResolvedValue(undefined)
    const store = useConfigStore()
    await store.toggleActivityCategoryFavorite('44')
    vi.mocked(saveConfig).mockRejectedValueOnce(new Error('存储空间不足'))

    await expect(store.toggleActivityCategoryFavorite('15')).rejects.toThrow('存储空间不足')
    expect(store.config.remoteQuery.favoriteCategoryIds).toEqual(['44'])
  })

  it.each([false, true])('收藏保存失败=%s 时，并发切换活动仍持久化正确的收藏', async (failFavorite) => {
    const { saveConfig } = await import('../composables/useLocalStorageDB')
    const { useConfigStore } = await import('./config')
    const store = useConfigStore()
    let finishFavorite!: () => void
    const pendingFavorite = new Promise<void>(resolve => { finishFavorite = resolve })
    const savedConfigs: typeof store.config[] = []
    vi.mocked(saveConfig).mockReset().mockImplementation(async config => {
      savedConfigs.push(JSON.parse(JSON.stringify(config)))
      if (savedConfigs.length === 1) {
        await pendingFavorite
        if (failFavorite) throw new Error('收藏写入失败')
      }
    })

    const favorite = store.toggleActivityCategoryFavorite('44')
    const favoriteResult = failFavorite
      ? expect(favorite).rejects.toThrow('收藏写入失败')
      : expect(favorite).resolves.toBeUndefined()
    await Promise.resolve()
    const selection = store.selectActivityCategory('15')
    expect(savedConfigs).toHaveLength(1)
    expect(store.config.remoteQuery.favoriteCategoryIds).toEqual([])
    finishFavorite()
    await favoriteResult
    await selection

    const expectedFavorites = failFavorite ? [] : ['44']
    expect(savedConfigs).toHaveLength(2)
    expect(savedConfigs[1].remoteQuery.categoryId).toBe('15')
    expect(savedConfigs[1].remoteQuery.favoriteCategoryIds).toEqual(expectedFavorites)
    expect(store.config.remoteQuery.categoryId).toBe('15')
    expect(store.config.remoteQuery.favoriteCategoryIds).toEqual(expectedFavorites)
  })
})
