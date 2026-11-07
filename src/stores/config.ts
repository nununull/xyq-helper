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
    /** 替换并持久化完整应用配置。 */
    async update(config: AppConfig) {
      this.config = config
      await saveConfig(config)
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
    /** 更新答案语音播报开关并立即持久化。 */
    async setSpeechEnabled(speechEnabled: boolean) {
      const nextConfig = structuredClone(toRaw(this.config))
      nextConfig.overlay.speechEnabled = speechEnabled
      await this.update(nextConfig)
    },
  },
})
