import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const args = parseArgs(process.argv.slice(2))
const inputPath = resolve(projectRoot, args.input ?? 'data/raw/questions.jsonl')
const questionsOutput = resolve(projectRoot, args.questions ?? 'public/data/questions.json')
const indexOutput = resolve(projectRoot, args.index ?? 'public/data/trigram-index.json')
const versionOutput = resolve(projectRoot, args.version ?? 'public/data/version.json')

async function main() {
  const records = normalizeRecords(await readJsonl(inputPath))
  const index = buildTrigramIndex(records)
  const questionsPayload = JSON.stringify(records, null, 2)
  const indexPayload = JSON.stringify(index)
  const hash = createHash('sha256')
    .update(questionsPayload)
    .update(indexPayload)
    .digest('hex')

  await mkdir(dirname(questionsOutput), { recursive: true })
  await mkdir(dirname(indexOutput), { recursive: true })
  await mkdir(dirname(versionOutput), { recursive: true })
  await writeFile(questionsOutput, `${questionsPayload}\n`, 'utf8')
  await writeFile(indexOutput, indexPayload, 'utf8')
  await writeFile(versionOutput, `${JSON.stringify({
    version: createVersion(),
    questionCount: records.length,
    hash,
    searchMode: 'json-trigram',
    generatedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8')

  console.log(`JSON questions written: ${questionsOutput}`)
  console.log(`Trigram index written: ${indexOutput}`)
  console.log(`Question count: ${records.length}`)
}

async function readJsonl(filePath) {
  const content = await readFile(filePath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      throw new Error(`Question input not found: ${filePath}`)
    }
    throw error
  })

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`)
      }
    })
}

function normalizeRecords(records) {
  const seen = new Set()
  const normalized = []

  for (const record of records) {
    const question = String(record.question ?? '').trim()
    const answer = String(record.answer ?? '').trim().toUpperCase()
    const answerText = String(record.answerText ?? record.a ?? '').trim()
    if (!question || (!/^[ABCD]$/.test(answer) && !answerText)) {
      continue
    }

    const options = record.options ?? {}
    const normalizedQuestion = normalizeText(question)
    const normalizedOptions = ['A', 'B', 'C', 'D']
      .map((key) => `${key}${normalizeText(options[key] ?? '')}`)
      .join('')
    const hash = record.contentHash ?? createHash('sha1')
      .update(`${normalizedQuestion}|${normalizedOptions}|${answer}|${normalizeText(answerText)}`)
      .digest('hex')

    if (seen.has(hash)) {
      continue
    }
    seen.add(hash)

    normalized.push({
      id: normalized.length + 1,
      question,
      normalizedQuestion,
      options: {
        A: String(options.A ?? ''),
        B: String(options.B ?? ''),
        C: String(options.C ?? ''),
        D: String(options.D ?? ''),
      },
      normalizedOptions,
      ...( /^[ABCD]$/.test(answer) ? { answer } : {} ),
      answerText,
      category: String(record.category ?? ''),
      subCategory: String(record.subCategory ?? ''),
      categories: Array.isArray(record.categories) ? record.categories : [],
      tags: Array.isArray(record.tags) ? record.tags : [],
      sources: Array.isArray(record.sources) ? record.sources : [],
      source: String(record.source ?? 'unknown'),
      confidence: Number(record.confidence ?? 1),
      occurrenceCount: Number(record.occurrenceCount ?? 0),
      questionHash: hash,
      contentHash: hash,
    })
  }

  return normalized
}

function buildTrigramIndex(records) {
  const index = {}

  for (const record of records) {
    const grams = new Set([
      ...createTrigrams(record.normalizedQuestion),
      ...createTrigrams(record.normalizedOptions),
    ])

    for (const gram of grams) {
      index[gram] ??= []
      index[gram].push(record.id)
    }
  }

  return index
}

function createTrigrams(text) {
  const normalized = normalizeText(text)
  if (!normalized) {
    return []
  }
  if (normalized.length <= 3) {
    return [normalized]
  }

  const grams = []
  for (let index = 0; index <= normalized.length - 3; index += 1) {
    grams.push(normalized.slice(index, index + 3))
  }
  return grams
}

function normalizeText(text) {
  return String(text)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[，。！？、；：“”‘’（）【】《》·,.!?;:"'()[\]<>]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

function createVersion() {
  const now = new Date()
  return `v${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`
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

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
