import type { ActivityCategoryGroup } from '../../types/remoteQuestion'

/** 按分类名称筛选分组，并移除没有匹配项的空分组。 */
export function filterCategoryGroups(
  groups: ActivityCategoryGroup[],
  keyword: string,
): ActivityCategoryGroup[] {
  const normalizedKeyword = keyword.trim().toLocaleLowerCase('zh-CN')
  if (!normalizedKeyword) return groups

  return groups
    .map((group) => ({
      ...group,
      categories: group.categories.filter((category) => (
        category.name.toLocaleLowerCase('zh-CN').includes(normalizedKeyword)
      )),
    }))
    .filter((group) => group.categories.length > 0)
}
