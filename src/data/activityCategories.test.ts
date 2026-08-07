import { describe, expect, it } from 'vitest'
import { activityCategoryGroups } from './activityCategories'

describe('175DT 静态分类清单', () => {
  it('包含官网当前全部七组五十三个可查询分类', () => {
    const categories = activityCategoryGroups.flatMap((group) => group.categories)

    expect(activityCategoryGroups.map((group) => group.name)).toEqual([
      '副本', '科举', '日常活动', '节日活动', '口袋版', '其他', '更多',
    ])
    expect(categories).toHaveLength(53)
    expect(new Set(categories.map((category) => category.id)).size).toBe(53)
  })
})
