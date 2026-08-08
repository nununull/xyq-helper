<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { activityCategoryGroups } from '../data/activityCategories'
import { filterCategoryGroups } from '../features/categories/filterCategoryGroups'

const props = defineProps<{
  selectedId: string
}>()

const emit = defineEmits<{
  select: [categoryId: string]
}>()

const keyword = ref('')
const expandedGroups = ref(new Set<string>())
const totalCount = activityCategoryGroups.reduce(
  (count, group) => count + group.categories.length,
  0,
)
const visibleGroups = computed(() => filterCategoryGroups(activityCategoryGroups, keyword.value))

/** 自动展开当前分类所在分组，确保已选项始终可见。 */
function revealSelectedCategory(categoryId: string): void {
  const selectedGroup = activityCategoryGroups.find((group) => (
    group.categories.some((category) => category.id === categoryId)
  ))
  if (!selectedGroup) return
  expandedGroups.value = new Set([...expandedGroups.value, selectedGroup.name])
}

watch(() => props.selectedId, revealSelectedCategory, { immediate: true })

/** 判断分类组是否展开；搜索时自动展示所有命中结果。 */
function isExpanded(groupName: string): boolean {
  return Boolean(keyword.value.trim()) || expandedGroups.value.has(groupName)
}

/** 切换单个活动分类组的折叠状态。 */
function toggleGroup(groupName: string): void {
  const next = new Set(expandedGroups.value)
  if (next.has(groupName)) next.delete(groupName)
  else next.add(groupName)
  expandedGroups.value = next
}
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
        <button type="button" class="category-group-toggle" @click="toggleGroup(group.name)">
          <span>{{ isExpanded(group.name) ? '▾' : '▸' }} {{ group.name }}</span>
          <small>{{ group.categories.length }}</small>
        </button>
        <div v-if="isExpanded(group.name)" class="category-group-items">
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
        </div>
      </section>
      <p v-if="visibleGroups.length === 0" class="muted">没有匹配的分类。</p>
    </div>
  </aside>
</template>
