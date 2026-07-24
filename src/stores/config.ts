import { defineStore } from 'pinia'
import { defaultAppConfig, type AppConfig } from '../types/config'
import { loadConfig, saveConfig } from '../composables/useLocalStorageDB'

export const useConfigStore = defineStore('config', {
  state: () => ({
    config: structuredClone(defaultAppConfig) as AppConfig,
    loaded: false,
  }),
  actions: {
    async load() {
      this.config = (await loadConfig()) ?? structuredClone(defaultAppConfig)
      this.loaded = true
    },
    async update(config: AppConfig) {
      this.config = config
      await saveConfig(config)
    },
  },
})
