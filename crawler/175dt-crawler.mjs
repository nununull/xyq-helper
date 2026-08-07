import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 175DT 题库爬虫
 *
 * 这个脚本负责把 175DT 搜索接口返回的题目转换为项目统一的 JSONL 题库格式。
 * 它不是直接下载“全量数据库”，而是通过“分类 ID + 搜索关键词”调用搜索接口。
 *
 * 已确认接口：
 *   https://s.175dt.com/?id=<分类ID>&kw=<关键词>&c=10000
 *
 * 常用命令：
 *
 * 1. 只抓一个分类的一个关键词：
 *   node crawler/175dt-crawler.mjs --ids 44 --kw 隋朝
 *
 * 2. 抓多个分类和多个关键词：
 *   node crawler/175dt-crawler.mjs --ids 44,15,16 --kw 隋朝,李白,杜甫
 *
 * 3. 从关键词文件读取，每行一个关键词：
 *   node crawler/175dt-crawler.mjs --ids 44 --keywords-file data/keywords.txt
 *
 * 4. 滚雪球抓取：从初始关键词抓到题目，再从新题题干和答案中提取新关键词继续抓：
 *   node crawler/175dt-crawler.mjs --ids 44 --kw 隋朝 --expand true --rounds 3 --max-keywords-per-round 50 --delay 1200
 *
 * 5. 指定输出文件和状态文件：
 *   node crawler/175dt-crawler.mjs --ids 44 --kw 隋朝 --jsonl data/raw/questions.jsonl --state data/raw/questions.jsonl.state.json
 *
 * 参数说明：
 *   --ids                    分类 ID，逗号分隔。不传时会对导航页解析到的全部分类搜索。
 *   --kw                     初始关键词，逗号分隔。
 *   --keywords-file          关键词文件路径，每行一个关键词。
 *   --expand true            启用滚雪球扩展模式。
 *   --rounds 3               滚雪球最多执行几轮，默认 3。
 *   --max-keywords-per-round 每轮最多使用多少个新关键词，默认 80。
 *   --delay 1200             每次请求后的等待毫秒数，默认 300。正式抓取建议 800-1500。
 *   --count 10000            传给 175DT 搜索接口的 c 参数。
 *   --jsonl                  题目输出 JSONL 路径，默认 data/raw/questions.jsonl。
 *   --output                 分类输出 JSON 路径，默认 data/raw/175dt-categories.json。
 *   --state                  断点状态文件路径，默认跟随 JSONL，后缀为 .state.json。
 *   --rewrite-output true    用内存中的题目重写 JSONL。正常抓取不需要，默认边抓边追加。
 *   --quiet true             只输出关键汇总，隐藏单次请求和跳过日志。
 *
 * 断点续跑：
 *   脚本会先读取已有 JSONL，把已有题目的 hash 放进内存 Set。
 *   每抓到新题会立即 append 到 JSONL。
 *   每完成一个 “分类ID + 关键词” 请求，会把 processedKey 写入 state 文件。
 *   中途停止后，重跑同一条命令即可继续；已入库题目和已完成关键词不会重复处理。
 *
 * 去重规则：
 *   爬虫层 questionHash = 标准化题干 + 标准化答案文本 + 分类 + 子分类。
 *   这能避免同分类内重复写入，同时保留跨分类题目来源。
 *   后续 scripts/merge-questions.mjs 会再按 contentHash 做跨平台全局合并。
 *
 * 请求频率：
 *   是否封 IP 取决于 175DT 服务端策略，脚本不能保证绝对安全。
 *   不要并发运行。正式抓取建议 --delay 800 到 --delay 1500，并先限制 --ids 小范围验证。
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const baseUrl = 'https://175dt.com'
const searchUrl = 'https://s.175dt.com/'
const args = parseArgs(process.argv.slice(2))
const quiet = args.quiet === 'true'

async function main() {
  const startedAt = Date.now()
  // 输出路径都基于项目根目录解析，便于从任意终端位置执行脚本。
  const categoriesOutput = resolve(projectRoot, args.output ?? 'data/raw/175dt-categories.json')
  const questionsOutput = resolve(projectRoot, args.jsonl ?? 'data/raw/questions.jsonl')
  const stateOutput = resolve(projectRoot, args.state ?? `${questionsOutput}.state.json`)

  logSummary('启动 175DT 题库爬虫')
  logDetail(`项目目录：${projectRoot}`)
  logDetail(`题目输出：${questionsOutput}`)
  logDetail(`分类输出：${categoriesOutput}`)
  logDetail(`状态文件：${stateOutput}`)
  logDetail(`请求延迟：${Number(args.delay ?? 300)}ms`)
  logDetail(`滚雪球：${args.expand === 'true' ? '开启' : '关闭'}`)

  // 175DT 导航页包含分类入口，搜索接口里的 id 就来自这些 /数字 页面。
  logSummary('读取分类导航...')
  const homeHtml = await fetchText(`${baseUrl}/5`)
  const categories = filterCategories(parseCategories(homeHtml), args.ids)
  logSummary(`分类数量：${categories.length}${args.ids ? `，指定 ID：${args.ids}` : '，未指定 ID，将搜索全部分类'}`)
  logDetail(`分类列表：${categories.map((category) => `${category.id}:${category.name}`).join('，')}`)

  // 断点续跑依赖两部分状态：
  // 1. 已有 JSONL 里的题目 hash，用于避免重复入库。
  // 2. state 文件里的 processedKeys，用于避免重复请求同一个分类和关键词。
  const seenQuestionHashes = new Set()
  const questions = await loadExistingQuestions(questionsOutput, seenQuestionHashes)
  const crawlState = await loadCrawlState(stateOutput)
  logSummary(`已加载历史题目：${questions.length} 条`)
  logSummary(`已处理关键词组合：${crawlState.processedKeys.length} 个`)

  const keywords = await loadKeywords(args)
  logSummary(`初始关键词：${keywords.length} 个${keywords.length ? `，${keywords.slice(0, 12).join('，')}${keywords.length > 12 ? '...' : ''}` : ''}`)
  if (keywords.length > 0) {
    // expand 模式会从新增题目里继续提取关键词；普通模式只搜索用户提供的关键词。
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

  // 默认抓取过程是 append 写入，避免中途停止时丢失本轮已抓到的新题。
  // 只有明确传入 --rewrite-output true 时，才用内存结果重写整个 JSONL。
  if (args['rewrite-output'] === 'true') {
    await writeFile(
      questionsOutput,
      questions.map((question) => JSON.stringify(question)).join('\n') + (questions.length ? '\n' : ''),
      'utf8',
    )
  }

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`分类已写入：${categoriesOutput}`)
  console.log(`题目 JSONL 已写入：${questionsOutput}，数量：${questions.length}`)
  console.log(`爬虫结束：耗时 ${elapsedSeconds}s`)
  if (questions.length === 0) {
    console.log('提示：未提供关键词或搜索无结果。使用 --kw 隋朝,李白 或 --keywords-file data/keywords.txt 抓取题目。')
  }
}

async function loadCrawlState(filePath) {
  // 没有状态文件时视为首次运行。
  const content = await readFile(filePath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return ''
    }
    throw error
  })

  if (!content.trim()) {
    logDetail('未发现断点状态文件，将从空状态开始。')
    return { processedKeys: [] }
  }

  const parsed = JSON.parse(content)
  const state = {
    processedKeys: Array.isArray(parsed.processedKeys) ? parsed.processedKeys : [],
  }
  logDetail(`断点状态已读取：${filePath}`)
  return state
}

async function saveCrawlState(filePath, crawlState) {
  // 每处理完一个关键词组合就写状态，确保 Ctrl+C 或异常退出后可续跑。
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify({
    ...crawlState,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8')
}

async function loadExistingQuestions(filePath, seenQuestionHashes) {
  // 已有 JSONL 是事实来源。先加载它，后续抓到重复题直接跳过。
  const content = await readFile(filePath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      logDetail('未发现历史 JSONL，将创建新的题库文件。')
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

  logSummary(`滚雪球配置：rounds=${rounds}，maxKeywordsPerRound=${maxKeywordsPerRound}`)
  for (let round = 1; round <= rounds && currentKeywords.length > 0; round += 1) {
    // 每轮只取有限数量关键词，防止滚雪球过快扩大请求量。
    const roundKeywords = currentKeywords
      .filter((keyword) => !usedKeywords.has(keyword))
      .slice(0, maxKeywordsPerRound)

    if (roundKeywords.length === 0) {
      logSummary(`第 ${round} 轮没有可用新关键词，提前结束。`)
      break
    }

    roundKeywords.forEach((keyword) => usedKeywords.add(keyword))
    const beforeCount = questions.length
    logSummary(`开始第 ${round} 轮：关键词 ${roundKeywords.length} 个，当前题目 ${beforeCount} 条`)
    logDetail(`第 ${round} 轮关键词：${roundKeywords.join('，')}`)
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

    // 只从“本轮新增题”提取下一轮关键词，避免旧题反复扩展。
    currentKeywords = extractKeywords(newRecords)
      .filter((keyword) => !usedKeywords.has(keyword))
      .slice(0, maxKeywordsPerRound)

    console.log(`第 ${round} 轮完成：新增 ${questions.length - beforeCount} 题，下一轮关键词 ${currentKeywords.length} 个`)
    logDetail(`第 ${round} 轮提取的新关键词：${currentKeywords.join('，')}`)
  }
}

async function crawlKeywordBatch({ categories, keywords, questions, seenQuestionHashes, questionsOutput, stateOutput, crawlState, round }) {
  const newRecords = []
  const processedKeys = new Set(crawlState.processedKeys)
  const batchStats = {
    requested: 0,
    skippedProcessed: 0,
    hits: 0,
    inserted: 0,
    skippedDuplicate: 0,
  }

  for (const category of categories) {
    logSummary(`处理分类：${category.id} ${category.name}，关键词 ${keywords.length} 个`)
    for (const keyword of keywords) {
      // processedKey 表示某个分类已经搜索过某个关键词。重跑脚本时会直接跳过。
      const processedKey = `${category.id}|${keyword}`
      if (processedKeys.has(processedKey)) {
        batchStats.skippedProcessed += 1
        logDetail(`跳过已处理关键词：${processedKey}`)
        continue
      }

      batchStats.requested += 1
      logDetail(`请求搜索：分类=${category.id}:${category.name}，关键词=${keyword}`)
      const hits = await searchQuestions(category, keyword)
      batchStats.hits += hits.length
      let insertedForKeyword = 0
      let duplicatedForKeyword = 0
      logDetail(`搜索返回：分类=${category.id}:${category.name}，关键词=${keyword}，命中=${hits.length}`)
      for (const hit of hits) {
        // questionHash 是爬虫层去重键。命中已有题时不再 append。
        const questionHash = createQuestionHash(hit)
        if (seenQuestionHashes.has(questionHash)) {
          batchStats.skippedDuplicate += 1
          duplicatedForKeyword += 1
          continue
        }

        const record = { ...hit, crawlRound: round, questionHash }
        seenQuestionHashes.add(questionHash)
        questions.push(record)
        newRecords.push(record)
        batchStats.inserted += 1
        insertedForKeyword += 1
        // 立即落盘，避免长时间滚雪球中断后丢数据。
        await appendQuestion(questionsOutput, record)
        logDetail(`新增题目：${record.question} => ${record.answerText}`)
      }
      logSummary(`关键词完成：${processedKey}，命中 ${hits.length}，新增 ${insertedForKeyword}，重复 ${duplicatedForKeyword}`)

      processedKeys.add(processedKey)
      crawlState.processedKeys = [...processedKeys]
      await saveCrawlState(stateOutput, crawlState)
      logDetail(`断点已保存：${processedKey}`)
      await sleep(Number(args.delay ?? 1200))
    }
  }

  logSummary(
    `批次汇总：请求 ${batchStats.requested}，断点跳过 ${batchStats.skippedProcessed}，命中 ${batchStats.hits}，新增 ${batchStats.inserted}，重复跳过 ${batchStats.skippedDuplicate}`,
  )
  return newRecords
}

async function appendQuestion(filePath, record) {
  // JSONL 一行一题，便于追加、断点续跑和后续多源合并。
  await mkdir(dirname(filePath), { recursive: true })
  await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8')
}

async function loadKeywords(parsedArgs) {
  const keywords = []

  // --kw 适合临时小批量关键词。
  if (parsedArgs.kw) {
    keywords.push(...parsedArgs.kw.split(',').map((keyword) => keyword.trim()).filter(Boolean))
  }

  // --keywords-file 适合长期维护大词表。
  if (parsedArgs['keywords-file']) {
    const filePath = resolve(projectRoot, parsedArgs['keywords-file'])
    const content = await readFile(filePath, 'utf8')
    keywords.push(...content.split(/\r?\n/).map((keyword) => keyword.trim()).filter(Boolean))
  }

  return [...new Set(keywords)]
}

async function searchQuestions(category, keyword) {
  // 175DT 搜索接口的 id 是分类 ID，kw 是关键词，c 当前按较大值请求更多结果。
  const url = new URL(searchUrl)
  url.searchParams.set('id', category.id)
  url.searchParams.set('kw', keyword)
  url.searchParams.set('c', String(args.count ?? 10000))

  const startedAt = Date.now()
  const text = await fetchText(url.toString(), {
    accept: '*/*',
    origin: baseUrl,
    referer: `${baseUrl}/`,
  })
  const payload = JSON.parse(text)
  const hits = Array.isArray(payload.hits) ? payload.hits : []
  logDetail(`接口完成：${url.toString()}，状态=${payload.status ?? 'unknown'}，耗时=${Date.now() - startedAt}ms`)

  // 返回结构中 q 是题干 HTML，a 是答案文本。接口不返回 A/B/C/D 选项。
  return hits
    .map((hit) => normalizeSearchHit(hit, category, keyword))
    .filter(Boolean)
}

async function fetchText(url, extraHeaders = {}) {
  // 保持简单的串行请求，不做并发；频率由调用方的 --delay 控制。
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
  // 分类来自导航栏里的 /数字 链接，例如 /44 表示金兜洞兕大王。
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
  // 不传 --ids 时返回所有分类；传入时只保留指定 ID，降低请求量。
  if (!ids) {
    return categories
  }

  const wanted = new Set(ids.split(',').map((id) => id.trim()).filter(Boolean))
  return categories.filter((category) => wanted.has(category.id))
}

function normalizeSearchHit(hit, category, keyword) {
  // q/a 可能包含 <b> 高亮标签，需要清理成纯文本后入库。
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
  // 分类也放入 hash，是为了保留同题在不同活动中的来源。
  // 跨平台全局去重由 merge-questions.mjs 使用 contentHash 处理。
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
  // 关键词扩展故意使用轻量规则，不引入分词依赖。
  // 后续如果要提高质量，可以替换成词典分词或人工种子词表。
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
  // 从标准化中文文本中提取 2-4 字片段，作为下一轮搜索种子。
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
  // hash 前的标准化：全角转半角、去 HTML、去标点、去空白、转小写。
  return String(text)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/<[^>]+>/g, '')
    .replace(/[，。！？、；：“”‘’（）【】《》·,.!?;:"'()[\]<>]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

function cleanHtml(html) {
  // 搜索接口返回题干 HTML，这里只保留可用于检索和展示的纯文本。
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
  // 简单命令行参数解析：--key value 或 --flag 都支持。
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
  // 串行限速。抓取站点内容时不要移除这个等待。
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function logSummary(message) {
  console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${message}`)
}

function logDetail(message) {
  if (!quiet) {
    console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${message}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
