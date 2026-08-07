import { rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceUrl = 'https://175dt.com/'
const outputPath = resolve(projectRoot, 'src/data/activityCategories.ts')
const temporaryOutputPath = `${outputPath}.tmp`

/** 将有限的 HTML 实体还原为分类名称。 */
function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .trim()
}

/** 从一段子导航 HTML 中提取可查询的分类。 */
function parseCategoryLinks(html) {
  return [...html.matchAll(/<li><a href="\/(\d+)">([^<]+)<\/a><\/li>/g)]
    .map((match) => ({ id: match[1], name: decodeHtml(match[2]) }))
}

/** 按 175DT 导航结构解析分组，父分类仅作为标题。 */
export function parseCategoryGroups(html) {
  const navMatch = html.match(/<ul class="nav">([\s\S]*?)<\/ul>\s*<div class="main">/)
  if (!navMatch) throw new Error('未找到 175DT 分类导航')

  let remaining = navMatch[1]
  const groups = []
  const groupedPattern = /<li><a href="\/\d+">([^<]+)\(\d+\)<\/a><div[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul><\/div><\/li>/g
  const groupedMatches = [...remaining.matchAll(groupedPattern)]
  for (const match of groupedMatches) {
    groups.push({ name: decodeHtml(match[1]), categories: parseCategoryLinks(match[2]) })
    remaining = remaining.replace(match[0], '')
  }

  const morePattern = /<li><a href="javascript:void\(0\)">[\s\S]*?<\/a><div[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul><\/div><\/li>/
  const moreMatch = remaining.match(morePattern)
  const moreCategories = moreMatch ? parseCategoryLinks(moreMatch[1]) : []
  if (moreMatch) remaining = remaining.replace(moreMatch[0], '')

  const standalone = parseCategoryLinks(remaining)
  if (standalone.length) groups.push({ name: '其他', categories: standalone })
  if (moreCategories.length) groups.push({ name: '更多', categories: moreCategories })

  const categories = groups.flatMap((group) => group.categories)
  if (!categories.length) throw new Error('175DT 分类导航中没有可查询分类')
  if (new Set(categories.map((category) => category.id)).size !== categories.length) {
    throw new Error('175DT 分类导航包含重复分类 ID')
  }
  return groups
}

/** 将分类分组渲染为前端可直接导入的 TypeScript 静态数据。 */
function renderCategoryModule(groups) {
  return `import type { ActivityCategoryGroup } from '../types/remoteQuestion'\n\n`
    + `// 此文件由 npm run sync:categories 从 ${sourceUrl} 生成，请勿手工编辑。\n`
    + `export const activityCategoryGroups: ActivityCategoryGroup[] = ${JSON.stringify(groups, null, 2)}\n`
}

/** 下载官网导航并更新仓库内的静态分类清单。 */
async function main() {
  const response = await fetch(sourceUrl)
  if (!response.ok) throw new Error(`175DT 分类同步失败：HTTP ${response.status}`)
  const groups = parseCategoryGroups(await response.text())
  await writeFile(temporaryOutputPath, renderCategoryModule(groups), 'utf8')
  await rename(temporaryOutputPath, outputPath)
  console.log(`分类分组：${groups.length}`)
  console.log(`可查询分类：${groups.flatMap((group) => group.categories).length}`)
  console.log(`输出：${outputPath}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
