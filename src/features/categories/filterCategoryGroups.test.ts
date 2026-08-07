import { describe, expect, it } from 'vitest'
import { filterCategoryGroups } from './filterCategoryGroups'

const groups = [
  {
    name: '副本',
    categories: [
      { id: '14', name: '四季' },
      { id: '44', name: '金兜洞兕大王' },
    ],
  },
  { name: '科举', categories: [{ id: '15', name: '乡试' }] },
]

describe('分类搜索', () => {
  it('按分类名称过滤并移除空分组', () => {
    expect(filterCategoryGroups(groups, '金兜')).toEqual([
      { name: '副本', categories: [{ id: '44', name: '金兜洞兕大王' }] },
    ])
  })

  it('空关键词保留全部分组', () => {
    expect(filterCategoryGroups(groups, '  ')).toEqual(groups)
  })
})
