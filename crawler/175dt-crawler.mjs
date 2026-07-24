import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const baseUrl = 'https://175dt.com'
const args = parseArgs(process.argv.slice(2))

async function main() {
  const categoriesOutput = resolve(projectRoot, args.output ?? 'data/raw/175dt-categories.json')
  const questionsOutput = resolve(projectRoot, args.jsonl ?? 'data/raw/questions.jsonl')
  const homeHtml = await fetchText(`${baseUrl}/5`)
  const categories = parseCategories(homeHtml)
  const questions = []

  if (args.seed) {
    const seeds = args.seed.split(',').map((seed) => seed.trim()).filter(Boolean)
    for (const category of categories) {
      const html = await fetchText(`${baseUrl}${category.href}`)
      for (const seed of seeds) {
        questions.push(...parseQuestionsFromHtml(html, category, seed))
      }
      await sleep(Number(args.delay ?? 300))
    }
  }

  await mkdir(dirname(categoriesOutput), { recursive: true })
  await mkdir(dirname(questionsOutput), { recursive: true })
  await writeFile(categoriesOutput, `${JSON.stringify({
    source: baseUrl,
    crawledAt: new Date().toISOString(),
    categories,
  }, null, 2)}\n`, 'utf8')
  await writeFile(
    questionsOutput,
    questions.map((question) => JSON.stringify(question)).join('\n') + (questions.length ? '\n' : ''),
    'utf8',
  )

  console.log(`分类已写入：${categoriesOutput}`)
  console.log(`题目 JSONL 已写入：${questionsOutput}，数量：${questions.length}`)
  if (questions.length === 0) {
    console.log('提示：175DT 当前静态 HTML 不暴露完整题库；脚本已完成分类抓取和题目解析框架。')
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'xyq-helper-crawler/0.1',
      accept: 'text/html,application/xhtml+xml',
    },
  })
  if (!response.ok) {
    throw new Error(`请求失败：${url} ${response.status}`)
  }
  return await response.text()
}

function parseCategories(html) {
  const navMatch = html.match(/<ul class="nav">([\s\S]*?)<\/ul>\s*<div class="main">/)
  const navHtml = navMatch?.[1] ?? html
  const categories = []
  const linkPattern = /<a\s+href="(\/\d+)"(?:\s+class="[^"]*")?>([\s\S]*?)<\/a>/g

  for (const match of navHtml.matchAll(linkPattern)) {
    const id = match[1].slice(1)
    const name = cleanHtml(match[2]).replace(/\(\d+\)$/, '')
    if (!name || categories.some((category) => category.id === id)) {
      continue
    }
    categories.push({ id, name, href: match[1] })
  }

  return categories
}

function parseQuestionsFromHtml(html, category, seed) {
  const resultMatch = html.match(/<div id="result"[^>]*>([\s\S]*?)<\/div>/)
  const resultText = cleanHtml(resultMatch?.[1] ?? '')
  if (!resultText.includes(seed)) {
    return []
  }

  const answerMatch = resultText.match(/答案[:：]\s*([ABCD])/i)
  if (!answerMatch) {
    return []
  }

  return [{
    question: resultText.replace(/答案[:：]\s*[ABCD].*$/i, '').trim(),
    options: {},
    answer: answerMatch[1].toUpperCase(),
    category: category.name,
    subCategory: category.name,
    source: '175dt',
    sourceUrl: `${baseUrl}${category.href}`,
    confidence: 0.8,
  }]
}

function cleanHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      continue
    }
    const key = arg.slice(2)
    const next = argv[index + 1]
    parsed[key] = next && !next.startsWith('--') ? next : 'true'
    if (next && !next.startsWith('--')) {
      index += 1
    }
  }
  return parsed
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
