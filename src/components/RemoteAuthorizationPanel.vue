<script setup lang="ts">
import type { RemoteAuthorizationState } from '../types/remoteQuestion'

defineProps<{
  state: RemoteAuthorizationState | null
  loading: boolean
  error: string
}>()

const emit = defineEmits<{ refresh: [] }>()
</script>

<template>
  <section class="panel authorization-panel" :aria-busy="loading">
    <div class="authorization-heading">
      <h2>175dt 授权</h2>
      <span v-if="state?.authorized" class="authorization-confirmed">已授权</span>
    </div>
    <template v-if="state && !state.authorized">
      <p>本次查询需要授权。微信扫码，完整看完并关闭广告后，回这里确认；也可稍后手动重试。</p>
      <a class="authorization-qr" :href="state.qrCodeUrl" target="_blank" rel="noopener noreferrer" aria-label="打开175dt官方授权二维码大图">
        <img :src="state.qrCodeUrl" alt="使用微信扫描此175dt官方二维码完成授权" width="200" height="200" referrerpolicy="no-referrer" />
      </a>
      <p class="authorization-help">扫码看广告可领取 60 分钟使用时间。点击二维码可打开大图。</p>
    </template>
    <p v-else-if="state?.authorized" class="authorization-expiry">有效至 {{ state.expiresAt }}</p>
    <p v-else-if="loading" role="status">正在获取官方授权状态…</p>
    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <button class="authorization-confirm" :class="{ 'primary-action': !state?.authorized }" type="button" :disabled="loading" @click="emit('refresh')">
      {{ loading ? '正在确认授权…' : state?.authorized ? '刷新授权状态' : '已完成授权，继续识别' }}
    </button>
  </section>
</template>
