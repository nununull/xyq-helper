import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const baseUrl = 'https://175dt.com'
const searchUrl = 'https://s.175dt.com/'
const args = parseArgs(process.argv.slice(2))

async function main() {
  const categoriesOutput = resolve(projectRoot, args.output ?? 'data/raw/175dt-categories.json')
  const questionsOutput = resolve(projectRoot, args.jsonl ?? 'data/raw/questions.jsonl')
  const stateOutput = resolve(projectRoot, args.state ?? `${questionsOutput}.state.json`)
  const homeHtml = await fetchText(`${baseUrl}/5`)
  const categories = filterCategories(parseCategories(homeHtml), args.ids)
  const seenQuestionHashes = new Set()
  const questions = await loadExistingQuestions(questionsOutput, seenQuestionHashes)
  const crawlState = await loadCrawlState(stateOutput)

  const keywords = await loadKeywords(args)
  if (keywords.length > 0) {
    if (args.expand === 'true') {
      await crawlWithExpansion({ categories, keywords, questions, seenQuestionHashes, questionsOutput, stateOutput, crawlState })
    } else {
      await crawlKeywordBatch({ categories, keywords, questions, seenQuestionHashes, questionsOutput, stateOutput, crawlState, round: 1 })
    }
  }

  await mkdir(dirname(categoriesOutput), { recursive: true })
  await mkdir(dirname(questionsOutput), { recursive: true })
  await writeFile(categoriesOutput, `${JSON.stringify({
    source: baseUrl,
    crawledAt: new Date().toISOString(),
    categories,
  }, null, 2)}\n`, 'utf8')
  if (args['rewrite-output'] === 'true') {
    await writeFile(
      questionsOutput,
      questions.map((question) => JSON.stringify(question)).join('\n') + (questions.length ? '\n' : ''),
      'utf8',
    )
  }

  console.log(`分类已写入：${categoriesOutput}`)
  console.log(`题目 JSONL 已写入：${questionsOutput}，数量：${questions.length}`)
  if (questions.length === 0) {
    console.log('提示：未提供关键词或搜索无结果。使用 --kw 隋朝,李白 或 --keywords-file data/keywords.txt 抓取题目。')
  }
}

async function loadCrawlState(filePath) {
  const content = await readFile(filePath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return ''
    }
    throw error
  })

  if (!content.trim()) {
    return { processedKeys: [] }
  }

  const parsed = JSON.parse(content)
  return {
    processedKeys: Array.isArray(parsed.processedKeys) ? parsed.processedKeys : [],
  }
}

async function saveCrawlState(filePath, crawlState) {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify({
    ...crawlState,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8')
}

async function loadExistingQuestions(filePath, seenQuestionHashes) {
  const content = await readFile(filePath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return ''
    }
    throw error
  })

  const records = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))

  for (const record of records) {
    seenQuestionHashes.add(createQuestionHash(record))
  }

  return records
}

async function crawlWithExpansion({ categories, keywords, questions, seenQuestionHashes, questionsOutput, stateOutput, crawlState }) {
  const rounds = Math.max(1, Number(args.rounds ?? 3))
  const maxKeywordsPerRound = Math.max(1, Number(args['max-keywords-per-round'] ?? 80))
  const usedKeywords = new Set()
  let currentKeywords = keywords

  for (let round = 1; round <= rounds && currentKeywords.length > 0; round += 1) {
    const roundKeywords = currentKeywords
      .filter((keyword) => !usedKeywords.has(keyword))
      .slice(0, maxKeywordsPerRound)

    if (roundKeywords.length === 0) {
      break
    }

    roundKeywords.forEach((keyword) => usedKeywords.add(keyword))
    const beforeCount = questions.length
    const newRecords = await crawlKeywordBatch({
      categories,
      keywords: roundKeywords,
      questions,
      seenQuestionHashes,
      questionsOutput,
      stateOutput,
      crawlState,
      round,
    })

    currentKeywords = extractKeywords(newRecords)
      .filter((keyword) => !usedKeywords.has(keyword))
      .slice(0, maxKeywordsPerRound)

    console.log(`第 ${round} 轮完成：新增 ${questions.length - beforeCount} 题，下一轮关键词 ${currentKeywords.length} 个`)
  }
}

async function crawlKeywordBatch({ categories, keywords, questions, seenQuestionHashes, questionsOutput, stateOutput, crawlState, round }) {
  const newRecords = []
  const processedKeys = new Set(crawlState.processedKeys)

  for (const category of categories) {
    for (const keyword of keywords) {
      const processedKey = `${category.id}|${keyword}`
      if (processedKeys.has(processedKey)) {
        continue
      }

      const hits = await searchQuestions(category, keyword)
      for (const hit of hits) {
        const questionHash = createQuestionHash(hit)
        if (seenQuestionHashes.has(questionHash)) {
          continue
        }

        const record = { ...hit, crawlRound: round, questionHash }
        seenQuestionHashes.add(questionHash)
        questions.push(record)
        newRecords.push(record)
        await appendQuestion(questionsOutput, record)
      }

      processedKeys.add(processedKey)
      crawlState.processedKeys = [...processedKeys]
      await saveCrawlState(stateOutput, crawlState)
      await sleep(Number(args.delay ?? 300))
    }
  }

  return newRecords
}

async function appendQuestion(filePath, record) {
  await mkdir(dirname(filePath), { recursive: true })
  await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8')
}

async function loadKeywords(parsedArgs) {
  const keywords = []

  if (parsedArgs.kw) {
    keywords.push(...parsedArgs.kw.split(',').map((keyword) => keyword.trim()).filter(Boolean))
  }

  if (parsedArgs['keywords-file']) {
    const filePath = resolve(projectRoot, parsedArgs['keywords-file'])
    const content = await readFile(filePath, 'utf8')
    keywords.push(...content.split(/\r?\n/).map((keyword) => keyword.trim()).filter(Boolean))
  }

  return [...new Set(keywords)]
}

async function searchQuestions(category, keyword) {
  const url = new URL(searchUrl)
  url.searchParams.set('id', category.id)
  url.searchParams.set('kw', keyword)
  url.searchParams.set('c', String(args.count ?? 10000))

  const text = await fetchText(url.toString(), {
    accept: '*/*',
    origin: baseUrl,
    referer: `${baseUrl}/`,
  })
  const payload = JSON.parse(text)
  const hits = Array.isArray(payload.hits) ? payload.hits : []

  return hits
    .map((hit) => normalizeSearchHit(hit, category, keyword))
    .filter(Boolean)
}

async function fetchText(url, extraHeaders = {}) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'xyq-helper-crawler/0.1',
      accept: 'text/html,application/xhtml+xml',
      ...extraHeaders,
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

function filterCategories(categories, ids) {
  if (!ids) {
    return categories
  }

  const wanted = new Set(ids.split(',').map((id) => id.trim()).filter(Boolean))
  return categories.filter((category) => wanted.has(category.id))
}

function normalizeSearchHit(hit, category, keyword) {
  const question = cleanHtml(String(hit.q ?? ''))
  const answerText = cleanHtml(String(hit.a ?? ''))

  if (!question || !answerText) {
    return null
  }

  return {
    question,
    options: {},
    answerText,
    category: category.name,
    subCategory: category.name,
    source: '175dt',
    sourceUrl: `${baseUrl}${category.href}`,
    sourceKeyword: keyword,
    confidence: 0.85,
  }
}

function createQuestionHash(record) {
  return createHash('sha1')
    .update([
      cleanTextForHash(record.question),
      cleanTextForHash(record.answerText ?? record.answer ?? ''),
      record.category ?? '',
      record.subCategory ?? '',
    ].join('|'))
    .digest('hex')
}

function extractKeywords(records) {
  const keywords = new Set()
  const stopWords = new Set(['下列', '以下', '哪个', '哪位', '多少', '什么', '不是', '的是', '关于', '组成'])

  for (const record of records) {
    for (const token of segmentChinese(`${record.question} ${record.answerText ?? ''}`)) {
      if (!stopWords.has(token)) {
        keywords.add(token)
      }
    }
  }

  return [...keywords]
}

function segmentChinese(text) {
  const normalized = cleanTextForHash(text)
  const tokens = new Set()

  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index <= normalized.length - size; index += 1) {
      const token = normalized.slice(index, index + size)
      if (/^[\u4e00-\u9fa5]+$/.test(token)) {
        tokens.add(token)
      }
    }
  }

  return [...tokens]
}

function cleanTextForHash(text) {
  return String(text)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/<[^>]+>/g, '')
    .replace(/[，。！？、；：“”‘’（）【】《》·,.!?;:"'()[\]<>]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
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
