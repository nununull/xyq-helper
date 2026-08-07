import { describe, expect, it } from 'vitest'
import { parseCategoryGroups } from './sync-175dt-categories.mjs'

describe('175DT 分类导航解析', () => {
  it('将父分类作为分组标题，只保留可查询的子分类', () => {
    const html = `
      <ul class="nav">
        <li><a href="/4">副本(2)</a><div><ul class="uk-nav uk-dropdown-nav">
          <li><a href="/14">四季</a></li><li><a href="/44">金兜洞兕大王</a></li>
        </ul></div></li>
        <li><a href="/53">签到答题</a></li>
        <li><a href="javascript:void(0)"><span>更多</span></a><div><ul class="uk-nav uk-dropdown-nav">
          <li><a href="/22">梦游志</a></li>
        </ul></div></li>
      </ul> <div class="main">
    `

    expect(parseCategoryGroups(html)).toEqual([
      {
        name: '副本',
        categories: [
          { id: '14', name: '四季' },
          { id: '44', name: '金兜洞兕大王' },
        ],
      },
      { name: '其他', categories: [{ id: '53', name: '签到答题' }] },
      { name: '更多', categories: [{ id: '22', name: '梦游志' }] },
    ])
  })
})
