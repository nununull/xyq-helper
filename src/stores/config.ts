import { defineStore } from 'pinia'
import { toRaw } from 'vue'
import { defaultAppConfig, mergeAppConfig, type AppConfig } from '../types/config'
import { loadConfig, saveConfig } from '../composables/useLocalStorageDB'

export const useConfigStore = defineStore('config', {
  state: () => ({
    config: structuredClone(defaultAppConfig) as AppConfig,
    loaded: false,
  }),
  actions: {
    /** 加载并补全持久化配置，兼容旧版本缺失的嵌套字段。 */
    async load() {
      this.config = mergeAppConfig(await loadConfig())
      this.loaded = true
    },
    /** 替换并持久化完整应用配置。 */
    async update(config: AppConfig) {
      this.config = config
      await saveConfig(config)
    },
    /** 选择并持久化活动分类，不直接修改当前配置对象。 */
    async selectActivityCategory(categoryId: string) {
      const nextConfig = structuredClone(toRaw(this.config))
      nextConfig.remoteQuery.categoryId = categoryId
      await this.update(nextConfig)
    },
  },
})
