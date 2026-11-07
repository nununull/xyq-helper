<script setup lang="ts">
import { useConfigStore } from '../stores/config'
import { CAPTURE_INTERVAL_MS, STABILITY_MS, MIN_QUERY_INTERVAL_MS, RATE_LIMIT_COOLDOWN_MS } from '../../shared/recognition-policy.mjs'

const configStore = useConfigStore()

/** 保存答案语音播报开关。 */
async function persistSpeechEnabled(): Promise<void> {
  await configStore.setSpeechEnabled(configStore.config.overlay.speechEnabled)
}

/** 保存滑块最终选择的阈值，不在拖动过程中反复写入本地数据库。 */
async function persistChangeThreshold(): Promise<void> {
  await configStore.setChangeThresholdPercent(configStore.config.capture.changeThresholdPercent)
}
</script>

<template>
  <section class="panel settings-panel">
    <h2>识别方式</h2>
    <p>本地每秒检查{{ 1000 / CAPTURE_INTERVAL_MS }}次画面，稳定{{ STABILITY_MS }}毫秒后才上传。</p>
    <p>两次查询至少间隔{{ MIN_QUERY_INTERVAL_MS / 1000 }}秒，同一画面只自动查询一次。</p>
    <p>失败后请手动重试；175dt限流时冷却{{ RATE_LIMIT_COOLDOWN_MS / 1000 }}秒。</p>
    <label class="sensitivity-setting" for="change-threshold">
      <span>换题变化阈值 <output>{{ configStore.config.capture.changeThresholdPercent.toFixed(1) }}%</output></span>
      <input id="change-threshold" v-model.number="configStore.config.capture.changeThresholdPercent" type="range" min="0" max="5" step="0.1" aria-describedby="change-threshold-help" @change="persistChangeThreshold" />
    </label>
    <p id="change-threshold-help" class="muted">越大越不敏感。鼠标划过反复识别就往右调，漏掉换题就往左调；0为最高灵敏度。</p>
    <label class="toggle-setting">
      <span>语音播报答案<small>直接播报175dt返回的答案文本</small></span>
      <input v-model="configStore.config.overlay.speechEnabled" type="checkbox" @change="persistSpeechEnabled" />
    </label>
    <small>只发送题干小图，不上传整张游戏窗口。题干框按活动和共享画面尺寸保存。题目位置变化时，可重新框选。</small>
  </section>
</template>
