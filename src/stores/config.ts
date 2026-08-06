import { defineStore } from 'pinia'
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
    async update(config: AppConfig) {
      this.config = config
      await saveConfig(config)
    },
  },
})
