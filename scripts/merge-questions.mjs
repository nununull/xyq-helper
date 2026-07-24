import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const args = parseArgs(process.argv.slice(2))
const inputArgs = splitList(args.input ?? 'data/raw/questions.jsonl')
const outputPath = resolve(projectRoot, args.output ?? 'data/raw/questions.jsonl')

async function main() {
  const inputFiles = await resolveInputFiles(inputArgs)
  const mergedByHash = new Map()

  for (const filePath of inputFiles) {
    const records = await readJsonl(filePath)
    for (const record of records) {
      const normalized = normalizeRecord(record, filePath)
      if (!normalized) {
        continue
      }

      const existing = mergedByHash.get(normalized.contentHash)
      if (existing) {
        mergeIntoExisting(existing, normalized)
      } else {
        mergedByHash.set(normalized.contentHash, normalized)
      }
    }
  }

  const merged = [...mergedByHash.values()]
    .sort((left, right) => left.question.localeCompare(right.question, 'zh-CN'))
    .map((record, index) => ({ ...record, id: index + 1 }))

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(
    outputPath,
    merged.map((record) => JSON.stringify(record)).join('\n') + (merged.length ? '\n' : ''),
    'utf8',
  )

  console.log(`Merged files: ${inputFiles.length}`)
  console.log(`Merged questions: ${merged.length}`)
  console.log(`Output: ${outputPath}`)
}

async function resolveInputFiles(inputs) {
  const files = new Set()

  for (const input of inputs) {
    const fullPath = resolve(projectRoot, input)
    const info = await stat(fullPath).catch(() => null)
    if (!info) {
      throw new Error(`Input path not found: ${fullPath}`)
    }

    if (info.isDirectory()) {
      for (const name of await readdir(fullPath)) {
        const child = resolve(fullPath, name)
        const childInfo = await stat(child)
        if (childInfo.isFile() && extname(child) === '.jsonl') {
          files.add(child)
        }
      }
    } else {
      files.add(fullPath)
    }
  }

  return [...files]
}

async function readJsonl(filePath) {
  const content = await readFile(filePath, 'utf8')
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(`${filePath} line ${index + 1} invalid JSON: ${error.message}`)
      }
    })
}

function normalizeRecord(record, filePath) {
  const question = String(record.question ?? '').trim()
  const answer = String(record.answer ?? '').trim().toUpperCase()
  const answerText = String(record.answerText ?? record.a ?? '').trim()
  const options = normalizeOptions(record.options ?? {})

  if (!question || (!/^[ABCD]$/.test(answer) && !answerText)) {
    return null
  }

  const normalizedQuestion = normalizeText(question)
  const normalizedAnswer = normalizeText(answerText || options[answer] || answer)
  const contentHash = createHash('sha1')
    .update(`${normalizedQuestion}|${normalizedAnswer}`)
    .digest('hex')
  const sources = Array.isArray(record.sources) && record.sources.length > 0
    ? record.sources
    : [normalizeSource(record, filePath)]
  const primarySource = sources[0] ?? normalizeSource(record, filePath)

  return {
    question,
    normalizedQuestion,
    options,
    normalizedOptions: ['A', 'B', 'C', 'D'].map((key) => `${key}${normalizeText(options[key] ?? '')}`).join(''),
    ...( /^[ABCD]$/.test(answer) ? { answer } : {} ),
    answerText,
    categories: uniqueStrings([record.category, record.subCategory, ...(record.categories ?? [])]),
    category: String(record.category ?? record.subCategory ?? ''),
    subCategory: String(record.subCategory ?? record.category ?? ''),
    tags: Array.isArray(record.tags) ? record.tags : [],
    sources,
    source: String(record.source ?? primarySource.name),
    confidence: Number(record.confidence ?? 0.8),
    occurrenceCount: Number(record.occurrenceCount ?? 0),
    contentHash,
  }
}

function mergeIntoExisting(existing, incoming) {
  existing.categories = uniqueStrings([...existing.categories, ...incoming.categories])
  existing.tags = uniqueStrings([...existing.tags, ...incoming.tags])
  existing.sources = mergeSources(existing.sources, incoming.sources)
  existing.confidence = calculateConfidence(existing.sources.length, existing.confidence, incoming.confidence)
  existing.occurrenceCount += incoming.occurrenceCount

  if (!existing.answer && incoming.answer) {
    existing.answer = incoming.answer
  }
  if (!existing.answerText && incoming.answerText) {
    existing.answerText = incoming.answerText
  }
  if (!existing.normalizedOptions && incoming.normalizedOptions) {
    existing.options = incoming.options
    existing.normalizedOptions = incoming.normalizedOptions
  }
}

function normalizeOptions(options) {
  return {
    A: String(options.A ?? ''),
    B: String(options.B ?? ''),
    C: String(options.C ?? ''),
    D: String(options.D ?? ''),
  }
}

function normalizeSource(record, filePath) {
  return {
    name: String(record.source ?? 'unknown'),
    url: String(record.sourceUrl ?? ''),
    category: String(record.category ?? ''),
    subCategory: String(record.subCategory ?? ''),
    keyword: String(record.sourceKeyword ?? ''),
    file: filePath.replace(projectRoot, '').replace(/^[\\/]/, ''),
  }
}

function mergeSources(left, right) {
  const sourceByKey = new Map()
  for (const source of [...left, ...right]) {
    sourceByKey.set(`${source.name}|${source.url}|${source.category}|${source.keyword}`, source)
  }
  return [...sourceByKey.values()]
}

function calculateConfidence(sourceCount, leftConfidence, rightConfidence) {
  const base = Math.max(leftConfidence, rightConfidence)
  const bonus = Math.min(0.15, Math.max(0, sourceCount - 1) * 0.05)
  return Math.min(1, Number((base + bonus).toFixed(2)))
}

function normalizeText(text) {
  return String(text)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/<[^>]+>/g, '')
    .replace(/[，。！？、；：“”‘’（）【】《》·,.!?;:"'()[\]<>]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
}

function splitList(value) {
  return String(value).split(',').map((item) => item.trim()).filter(Boolean)
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
