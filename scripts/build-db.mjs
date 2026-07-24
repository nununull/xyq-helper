import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import initSqlJs from 'sql.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const args = parseArgs(process.argv.slice(2))
const inputPath = resolve(projectRoot, args.input ?? 'data/raw/questions.jsonl')
const outputPath = resolve(projectRoot, args.output ?? 'public/data/questions.sqlite')
const versionPath = resolve(projectRoot, args.version ?? 'public/data/version.json')

async function main() {
  const records = normalizeRecords(await readJsonl(inputPath))
  const SQL = await initSqlJs()
  const db = new SQL.Database()

  const searchMode = createSchema(db)
  insertQuestions(db, records, searchMode)

  const buffer = Buffer.from(db.export())
  const hash = createHash('sha256').update(buffer).digest('hex')

  await mkdir(dirname(outputPath), { recursive: true })
  await mkdir(dirname(versionPath), { recursive: true })
  await writeFile(outputPath, buffer)
  await writeFile(versionPath, `${JSON.stringify({
    version: createVersion(),
    questionCount: records.length,
    hash,
    searchMode,
    generatedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8')

  db.close()
  console.log(`SQLite 题库已生成：${outputPath}`)
  console.log(`题目数量：${records.length}`)
  console.log(`版本文件：${versionPath}`)
}

async function readJsonl(filePath) {
  const content = await readFile(filePath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      throw new Error(`题库输入不存在：${filePath}`)
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
        throw new Error(`JSONL 第 ${index + 1} 行解析失败：${error.message}`)
      }
    })
}

function normalizeRecords(records) {
  const seen = new Set()
  const normalized = []

  for (const record of records) {
    const question = String(record.question ?? '').trim()
    const answer = String(record.answer ?? '').trim().toUpperCase()
    if (!question || !/^[ABCD]$/.test(answer)) {
      continue
    }

    const options = record.options ?? {}
    const normalizedQuestion = normalizeText(question)
    const normalizedOptions = ['A', 'B', 'C', 'D']
      .map((key) => `${key}${normalizeText(options[key] ?? '')}`)
      .join('')
    const questionHash = createHash('sha1')
      .update(`${normalizedQuestion}|${normalizedOptions}|${answer}`)
      .digest('hex')

    if (seen.has(questionHash)) {
      continue
    }

    seen.add(questionHash)
    normalized.push({
      question,
      normalizedQuestion,
      optionA: String(options.A ?? ''),
      optionB: String(options.B ?? ''),
      optionC: String(options.C ?? ''),
      optionD: String(options.D ?? ''),
      normalizedOptions,
      answer,
      answerType: record.answerType ?? 'single',
      category: record.category ?? '',
      subCategory: record.subCategory ?? '',
      tags: Array.isArray(record.tags) ? record.tags.join(',') : String(record.tags ?? ''),
      source: record.source ?? 'unknown',
      confidence: Number(record.confidence ?? 1),
      occurrenceCount: Number(record.occurrenceCount ?? 0),
      questionHash,
      now: new Date().toISOString(),
    })
  }

  return normalized
}

function createSchema(db) {
  db.run(`
    CREATE TABLE questions (
      id INTEGER PRIMARY KEY,
      question TEXT NOT NULL,
      normalized_question TEXT NOT NULL,
      option_a TEXT,
      option_b TEXT,
      option_c TEXT,
      option_d TEXT,
      normalized_options TEXT,
      answer TEXT NOT NULL,
      answer_type TEXT DEFAULT 'single',
      category TEXT,
      sub_category TEXT,
      tags TEXT,
      source TEXT NOT NULL,
      confidence REAL DEFAULT 1,
      occurrence_count INTEGER DEFAULT 0,
      question_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  let searchMode = 'table'

  try {
    db.run(`
      CREATE VIRTUAL TABLE questions_fts USING fts5(
        normalized_question,
        normalized_options,
        content = 'questions',
        content_rowid = 'id',
        tokenize = 'trigram'
      );
    `)
    searchMode = 'fts5-trigram'
  } catch (error) {
    console.warn(`trigram FTS5 unavailable, fallback to default FTS5: ${error.message}`)
    try {
      db.run(`
        CREATE VIRTUAL TABLE questions_fts USING fts5(
          normalized_question,
          normalized_options,
          content = 'questions',
          content_rowid = 'id'
        );
      `)
      searchMode = 'fts5-default'
    } catch (fallbackError) {
      console.warn(`FTS5 unavailable, fallback to normal table indexes: ${fallbackError.message}`)
      db.run(`
        CREATE INDEX idx_questions_normalized_question ON questions(normalized_question);
        CREATE INDEX idx_questions_hash ON questions(question_hash);
      `)
    }
  }

  db.run('INSERT INTO metadata(key, value) VALUES (?, ?)', ['search_mode', searchMode])
  return searchMode
}

function insertQuestions(db, records, searchMode) {
  const insertQuestion = db.prepare(`
    INSERT INTO questions (
      question, normalized_question, option_a, option_b, option_c, option_d,
      normalized_options, answer, answer_type, category, sub_category, tags,
      source, confidence, occurrence_count, question_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertFts = searchMode.startsWith('fts5')
    ? db.prepare(`
      INSERT INTO questions_fts(rowid, normalized_question, normalized_options)
      VALUES (?, ?, ?)
    `)
    : null

  db.run('BEGIN TRANSACTION')
  for (const record of records) {
    insertQuestion.run([
      record.question,
      record.normalizedQuestion,
      record.optionA,
      record.optionB,
      record.optionC,
      record.optionD,
      record.normalizedOptions,
      record.answer,
      record.answerType,
      record.category,
      record.subCategory,
      record.tags,
      record.source,
      record.confidence,
      record.occurrenceCount,
      record.questionHash,
      record.now,
      record.now,
    ])
    if (insertFts) {
      const rowId = db.exec('SELECT last_insert_rowid()')[0].values[0][0]
      insertFts.run([rowId, record.normalizedQuestion, record.normalizedOptions])
    }
  }
  db.run('COMMIT')

  insertQuestion.free()
  insertFts?.free()
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
