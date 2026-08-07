<script setup lang="ts">
import { computed, ref } from 'vue'
import { activityCategoryGroups } from '../data/activityCategories'
import { filterCategoryGroups } from '../features/categories/filterCategoryGroups'

defineProps<{
  selectedId: string
}>()

const emit = defineEmits<{
  select: [categoryId: string]
}>()

const keyword = ref('')
const totalCount = activityCategoryGroups.reduce(
  (count, group) => count + group.categories.length,
  0,
)
const visibleGroups = computed(() => filterCategoryGroups(activityCategoryGroups, keyword.value))
</script>

<template>
  <aside class="panel sidebar category-sidebar">
    <div class="category-title-row">
      <h2>活动分类</h2>
      <span>{{ totalCount }} 项</span>
    </div>
    <label class="category-search-label">
      <span>搜索分类</span>
      <input v-model="keyword" class="category-search" type="search" placeholder="输入分类名称" />
    </label>
    <div class="category-list">
      <section v-for="group in visibleGroups" :key="group.name" class="category-group">
        <h3>{{ group.name }} <span>{{ group.categories.length }}</span></h3>
        <button
          v-for="category in group.categories"
          :key="category.id"
          type="button"
          class="category-button"
          :class="{ active: selectedId === category.id }"
          @click="emit('select', category.id)"
        >
          {{ category.name }}
        </button>
      </section>
      <p v-if="visibleGroups.length === 0" class="muted">没有匹配的分类。</p>
    </div>
  </aside>
</template>
