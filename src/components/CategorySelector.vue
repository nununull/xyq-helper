<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import CategoryItem from './CategoryItem.vue'
import { activityCategoryGroups } from '../data/activityCategories'
import { filterCategoryGroups } from '../features/categories/filterCategoryGroups'
import { useFavoriteSorting } from '../features/categories/useFavoriteSorting'
import { useConfigStore } from '../stores/config'
import type { ActivityCategory } from '../types/remoteQuestion'

const props = defineProps<{
  selectedId: string
}>()

const emit = defineEmits<{
  select: [categoryId: string]
}>()

const keyword = ref('')
const favoritesExpanded = ref(true)
const expandedGroups = ref(new Set<string>())
const configStore = useConfigStore()
const savingFavorite = ref(false)
const favoriteError = ref('')
const categorySearch = ref<HTMLInputElement | null>(null)
const favoriteList = ref<HTMLElement | null>(null)
const categoryById = new Map(activityCategoryGroups.flatMap(group => (
  group.categories.map(category => [category.id, category] as const)
)))
const favoriteIds = computed(() => configStore.config.remoteQuery.favoriteCategoryIds)
const favoriteCategories = computed(() => favoriteIds.value
  .map(id => categoryById.get(id))
  .filter((category): category is ActivityCategory => Boolean(category)))
const totalCount = activityCategoryGroups.reduce(
  (count, group) => count + group.categories.length,
  0,
)
const visibleGroups = computed(() => filterCategoryGroups(activityCategoryGroups, keyword.value))
const { drag, startDrag, moveDrag, finishDrag, cancelDrag } = useFavoriteSorting(favoriteList, reorderFavorite, () => savingFavorite.value)

watch(favoritesExpanded, expanded => { if (!expanded) cancelDrag() })

/** 保存或移动导致按钮暂时失焦时，恢复原按钮或接回搜索框。 */
async function restoreFavoriteFocus(control: Element | null): Promise<void> {
  await nextTick()
  if (control instanceof HTMLButtonElement
    && control.matches('.category-favorite-toggle, .category-drag-handle')
    && document.activeElement === document.body) {
    (control.isConnected ? control : categorySearch.value)?.focus()
  }
}

/** 保存拖动或键盘调整后的收藏顺序，失败时沿用原顺序并允许重试。 */
async function reorderFavorite(categoryId: string, targetId: string, after: boolean): Promise<void> {
  if (savingFavorite.value) return
  const focusedControl = document.activeElement
  savingFavorite.value = true
  favoriteError.value = ''
  try {
    await configStore.moveActivityCategoryFavorite(categoryId, targetId, after)
  } catch {
    favoriteError.value = '顺序没存上，请重新拖动排序。'
  } finally {
    savingFavorite.value = false
    await restoreFavoriteFocus(focusedControl)
  }
}

/** 在排序手柄上按上下方向键，将收藏移到相邻项前后。 */
async function moveFavoriteByKeyboard(categoryId: string, direction: number): Promise<void> {
  if (savingFavorite.value || drag.value) return
  const index = favoriteCategories.value.findIndex(category => category.id === categoryId)
  const target = favoriteCategories.value[index + direction]
  if (index >= 0 && target) await reorderFavorite(categoryId, target.id, direction > 0)
}

/** 保存收藏变更并提示失败；取消收藏后将键盘焦点接回搜索框。 */
async function toggleFavorite(categoryId: string): Promise<void> {
  if (savingFavorite.value || drag.value) return
  const focusedControl = document.activeElement
  savingFavorite.value = true
  favoriteError.value = ''
  try {
    await configStore.toggleActivityCategoryFavorite(categoryId)
  } catch {
    favoriteError.value = '收藏没存上，请再点一次星标重试。'
  } finally {
    savingFavorite.value = false
    await restoreFavoriteFocus(focusedControl)
  }
}

/** 从收藏直接切换活动，同时清空旧搜索以展示当前活动所在分组。 */
function selectFavorite(categoryId: string): void {
  keyword.value = ''
  emit('select', categoryId)
  console.info(JSON.stringify({ msg: '从收藏切换活动', categoryId }))
}

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
    <section class="category-favorites" aria-labelledby="favorite-categories-title">
      <h3 id="favorite-categories-title" class="category-favorites-heading">
        <button type="button" class="category-group-toggle category-favorites-toggle" :aria-expanded="favoritesExpanded" aria-controls="favorite-categories-content" @click="favoritesExpanded = !favoritesExpanded">
          <span class="category-group-label">
            <svg class="category-chevron" :class="{ expanded: favoritesExpanded }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
            我的收藏
          </span>
          <small>{{ favoriteCategories.length }} 项</small>
        </button>
      </h3>
      <div id="favorite-categories-content" v-show="favoritesExpanded">
        <div v-if="favoriteCategories.length" ref="favoriteList" class="category-favorites-list" :aria-busy="savingFavorite">
          <CategoryItem
            v-for="category in favoriteCategories"
            :key="category.id"
            :category="category"
            :selected="selectedId === category.id"
            :favorite="true"
            :saving="savingFavorite || Boolean(drag)"
            :data-favorite-id="category.id"
            :class="{
              'favorite-dragging': drag?.moved && drag.categoryId === category.id,
              'favorite-drop-before': drag?.moved && drag.targetId === category.id && drag.categoryId !== category.id && !drag.after,
              'favorite-drop-after': drag?.moved && drag.targetId === category.id && drag.categoryId !== category.id && drag.after,
            }"
            @select="selectFavorite"
            @favorite="toggleFavorite"
          >
            <template #leading>
              <button
                type="button"
                class="category-drag-handle"
                :aria-label="`拖动${category.name}排序`"
                aria-description="按上下方向键调整收藏顺序"
                aria-keyshortcuts="ArrowUp ArrowDown"
                title="拖动排序，或按上下方向键调整"
                :disabled="savingFavorite || favoriteCategories.length < 2"
                @pointerdown="startDrag($event, category.id)"
                @pointermove="moveDrag"
                @pointerup="finishDrag"
                @pointercancel="cancelDrag"
                @lostpointercapture="cancelDrag"
                @keydown.esc.prevent="cancelDrag"
                @keydown.up.prevent="moveFavoriteByKeyboard(category.id, -1)"
                @keydown.down.prevent="moveFavoriteByKeyboard(category.id, 1)"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="5" r="1.5" /><circle cx="15" cy="5" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="9" cy="19" r="1.5" /><circle cx="15" cy="19" r="1.5" /></svg>
              </button>
            </template>
          </CategoryItem>
        </div>
        <p v-else class="category-favorites-empty">点任务右侧的星标，收藏后直接切换。</p>
      </div>
    </section>
    <p v-if="favoriteError" class="category-favorite-error error-text" role="alert">{{ favoriteError }}</p>
    <label class="category-search-label">
      <span>搜索分类</span>
      <input ref="categorySearch" v-model="keyword" class="category-search" type="search" aria-label="搜索分类" placeholder="输入分类名称" />
    </label>
    <div class="category-list">
      <section v-for="group in visibleGroups" :key="group.name" class="category-group">
        <button type="button" class="category-group-toggle" :aria-expanded="isExpanded(group.name)" @click="toggleGroup(group.name)">
          <span class="category-group-label">
            <svg class="category-chevron" :class="{ expanded: isExpanded(group.name) }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
            {{ group.name }}
          </span>
          <small>{{ group.categories.length }}</small>
        </button>
        <div v-if="isExpanded(group.name)" class="category-group-items">
          <CategoryItem
            v-for="category in group.categories"
            :key="category.id"
            :category="category"
            :selected="selectedId === category.id"
            :favorite="favoriteIds.includes(category.id)"
            :saving="savingFavorite || Boolean(drag)"
            @select="emit('select', $event)"
            @favorite="toggleFavorite"
          />
        </div>
      </section>
      <p v-if="visibleGroups.length === 0" class="muted">没有匹配的分类。</p>
    </div>
  </aside>
</template>
