import { defineStore } from 'pinia'
import { toRaw } from 'vue'
import {
  defaultAppConfig,
  mergeAppConfig,
  normalizeCaptureFps,
  normalizeChangeThresholdPercent,
  type AppConfig,
} from '../types/config'
import { loadConfig, saveConfig } from '../composables/useLocalStorageDB'

let configWriteQueue = Promise.resolve()

/** 按调用顺序写入同一份应用配置，一次失败不阻断后续保存。 */
function enqueueConfigWrite(operation: () => Promise<void>): Promise<void> {
  const write = configWriteQueue.then(operation)
  configWriteQueue = write.catch(() => undefined)
  return write
}

export const useConfigStore = defineStore('config', {
  state: () => ({
    config: structuredClone(defaultAppConfig) as AppConfig,
    loaded: false,
  }),
  actions: {
    /** 保存换题变化阈值，正在运行的监测在下一帧直接采用。 */
    async setChangeThresholdPercent(value: number) {
      const nextConfig = structuredClone(toRaw(this.config))
      nextConfig.capture.changeThresholdPercent = normalizeChangeThresholdPercent(value)
      await this.update(nextConfig)
      console.info(JSON.stringify({ msg: '已保存换题变化阈值', changeThresholdPercent: nextConfig.capture.changeThresholdPercent }))
    },
    /** 加载并补全持久化配置，兼容旧版本缺失的嵌套字段。 */
    async load() {
      this.config = mergeAppConfig(await loadConfig())
      this.loaded = true
    },
    /** 替换并依次保存配置，收藏始终从当前已保存状态单向派生。 */
    async update(config: AppConfig) {
      config.remoteQuery.favoriteCategoryIds = [...this.config.remoteQuery.favoriteCategoryIds]
      this.config = config
      await enqueueConfigWrite(async () => {
        config.remoteQuery.favoriteCategoryIds = [...this.config.remoteQuery.favoriteCategoryIds]
        await saveConfig(config)
      })
    },
    /** 更新抽帧频率并立即持久化，刷新页面后继续沿用。 */
    async setCaptureFps(captureFps: number) {
      const nextConfig = structuredClone(toRaw(this.config))
      nextConfig.capture.captureFps = normalizeCaptureFps(captureFps)
      await this.update(nextConfig)
    },
    /** 选择并持久化活动分类，不直接修改当前配置对象。 */
    async selectActivityCategory(categoryId: string) {
      const nextConfig = structuredClone(toRaw(this.config))
      nextConfig.remoteQuery.categoryId = categoryId
      await this.update(nextConfig)
    },
    /** 与其他配置串行保存收藏，写入成功后才更新收藏状态。 */
    async toggleActivityCategoryFavorite(categoryId: string) {
      try {
        await enqueueConfigWrite(async () => {
          const nextConfig = structuredClone(toRaw(this.config))
          const previousIds = nextConfig.remoteQuery.favoriteCategoryIds
          const favorite = !previousIds.includes(categoryId)
          nextConfig.remoteQuery.favoriteCategoryIds = favorite
            ? [...previousIds, categoryId]
            : previousIds.filter(id => id !== categoryId)
          await saveConfig(nextConfig)
          this.config.remoteQuery.favoriteCategoryIds = nextConfig.remoteQuery.favoriteCategoryIds
          console.info(JSON.stringify({ msg: favorite ? '已收藏活动' : '已取消活动收藏', categoryId, favoriteCategoryIds: nextConfig.remoteQuery.favoriteCategoryIds }))
        })
      } catch (error) {
        console.error(JSON.stringify({ msg: '保存活动收藏失败', categoryId, error: error instanceof Error ? error.message : String(error) }))
        throw error
      }
    },
    /** 将收藏移到目标前后，串行落库成功后再更新界面顺序。 */
    async moveActivityCategoryFavorite(categoryId: string, targetId: string, after: boolean) {
      try {
        await enqueueConfigWrite(async () => {
          const previousIds = this.config.remoteQuery.favoriteCategoryIds
          if (categoryId === targetId || !previousIds.includes(categoryId) || !previousIds.includes(targetId)) return
          const favoriteIds = previousIds.filter(id => id !== categoryId)
          favoriteIds.splice(favoriteIds.indexOf(targetId) + Number(after), 0, categoryId)
          if (favoriteIds.every((id, index) => id === previousIds[index])) return
          const nextConfig = structuredClone(toRaw(this.config))
          nextConfig.remoteQuery.favoriteCategoryIds = favoriteIds
          await saveConfig(nextConfig)
          this.config.remoteQuery.favoriteCategoryIds = favoriteIds
          console.info(JSON.stringify({ msg: '已调整活动收藏顺序', categoryId, targetId, after, favoriteCategoryIds: favoriteIds }))
        })
      } catch (error) {
        console.error(JSON.stringify({ msg: '保存活动收藏顺序失败', categoryId, targetId, after, error: error instanceof Error ? error.message : String(error) }))
        throw error
      }
    },
    /** 更新答案语音播报开关并立即持久化。 */
    async setSpeechEnabled(speechEnabled: boolean) {
      const nextConfig = structuredClone(toRaw(this.config))
      nextConfig.overlay.speechEnabled = speechEnabled
      await this.update(nextConfig)
    },
  },
})
