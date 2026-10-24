<script setup lang="ts">
import { onMounted } from 'vue'
import Dashboard from './components/Dashboard.vue'
import { useConfigStore } from './stores/config'

const configStore = useConfigStore()

onMounted(() => {
  void configStore.load()
})
</script>

<template>
  <main class="app-shell">
    <Dashboard v-if="configStore.loaded" />
    <section v-else class="loading-panel">正在读取本地配置...</section>
  </main>
</template>
