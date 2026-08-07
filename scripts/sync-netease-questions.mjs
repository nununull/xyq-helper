import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  extractChunkAssetPaths,
  extractNeteaseQuestions,
} from './lib/netease-question-extractor.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const pageUrl = 'https://w.163.com/h5/xyq/dtk/index.html'
const outputPath = resolve(projectRoot, 'data/raw/netease-questions.jsonl')

/** 下载官方页面、发现所有题库分包并生成规范化 JSONL 数据。 */
async function main() {
  const pageSource = await fetchText(pageUrl)
  const initialAssets = extractScriptSources(pageSource, pageUrl)
  const runtimeUrl = initialAssets.find((url) => /\/app\.[\da-f]+\.js$/i.test(url))
  if (!runtimeUrl) throw new Error('未找到网易题库入口脚本')

  const runtimeSource = await fetchText(runtimeUrl)
  const chunkUrls = extractChunkAssetPaths(runtimeSource).map((path) => new URL(path, pageUrl).href)
  const assetUrls = [...new Set([...initialAssets, ...chunkUrls])]
  const recordsByHash = new Map()

  for (const assetUrl of assetUrls) {
    const source = assetUrl === runtimeUrl ? runtimeSource : await fetchText(assetUrl)
    for (const record of extractNeteaseQuestions(source, assetUrl)) {
      recordsByHash.set(record.contentHash, record)
    }
  }

  const records = [...recordsByHash.values()]
    .sort((left, right) => left.question.localeCompare(right.question, 'zh-CN'))
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(
    outputPath,
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    'utf8',
  )

  console.log(`网易官方题目：${records.length}`)
  console.log(`输出文件：${outputPath}`)
}

/** 提取页面中的入口脚本并解析为绝对地址。 */
function extractScriptSources(html, baseUrl) {
  return [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
    .map((match) => new URL(match[1], baseUrl).href)
}

/** 获取 UTF-8 文本，并为非成功响应提供清晰错误。 */
async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'xyq-helper/0.1 netease-question-sync' },
  })
  if (!response.ok) throw new Error(`下载失败 ${response.status}: ${url}`)
  return await response.text()
}

await main()
