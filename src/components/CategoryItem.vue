<script setup lang="ts">
import type { ActivityCategory } from '../types/remoteQuestion'

defineProps<{
  category: ActivityCategory
  selected: boolean
  favorite: boolean
  saving: boolean
}>()

const emit = defineEmits<{
  select: [categoryId: string]
  favorite: [categoryId: string]
}>()
</script>

<template>
  <div class="category-item" :class="{ active: selected }">
    <slot name="leading" />
    <button
      type="button"
      class="category-button"
      :aria-current="selected ? 'true' : undefined"
      @click="emit('select', category.id)"
    >
      {{ category.name }}
    </button>
    <button
      type="button"
      class="category-favorite-toggle"
      :aria-label="`${favorite ? '取消收藏' : '收藏'}${category.name}`"
      :title="favorite ? '取消收藏' : '收藏'"
      :aria-pressed="favorite"
      :disabled="saving"
      @click="emit('favorite', category.id)"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m12 3 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17.19l-5.56 2.93 1.06-6.2L3 9.53l6.22-.9L12 3Z" />
      </svg>
    </button>
  </div>
</template>
