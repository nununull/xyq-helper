<script setup lang="ts">
import { computed, onMounted } from 'vue'
import Dashboard from './components/Dashboard.vue'
import SetupWizard from './components/SetupWizard.vue'
import { useConfigStore } from './stores/config'

const configStore = useConfigStore()

const needsSetup = computed(
  () => !configStore.config.capture.questionRegion || !configStore.config.capture.optionsRegion,
)

onMounted(() => {
  void configStore.load()
})
</script>

<template>
  <main class="app-shell">
    <SetupWizard v-if="configStore.loaded && needsSetup" />
    <Dashboard v-else-if="configStore.loaded" />
    <section v-else class="loading-panel">正在读取本地配置...</section>
  </main>
</template>
