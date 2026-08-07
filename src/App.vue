<script setup lang="ts">
import { onMounted } from 'vue'
import Dashboard from './components/Dashboard.vue'
import { useConfigStore } from './stores/config'
import { useDBStore } from './stores/db'

const configStore = useConfigStore()
const dbStore = useDBStore()

onMounted(() => {
  void configStore.load()
  void dbStore.initializeQuestionIndex()
})
</script>

<template>
  <main class="app-shell">
    <Dashboard v-if="configStore.loaded && dbStore.ready" />
    <section v-else class="loading-panel">正在读取本地配置...</section>
  </main>
</template>
