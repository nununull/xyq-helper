import { createHash } from 'node:crypto'

const STRING_LITERAL = String.raw`"(?:\\.|[^"\\])*"`
const QUESTION_PATTERN = new RegExp(
  String.raw`\{Id:(${STRING_LITERAL}),Q:(${STRING_LITERAL}),A:(${STRING_LITERAL})\}`,
  'g',
)

/** 从 webpack runtime 的分包映射中还原全部异步 JavaScript 地址。 */
export function extractChunkAssetPaths(runtimeSource) {
  const mapping = runtimeSource.match(
    /return"static\/js\/"\+\((\{[^}]*\})\[e\]\|\|e\)\+"\."\+(\{[^}]*\})\[e\]\+"\.js"/,
  )
  if (!mapping) {
    throw new Error('未找到网易题库的 webpack 分包映射')
  }

  const names = parseNumericStringMap(mapping[1])
  const hashes = parseNumericStringMap(mapping[2])
  return Object.entries(hashes)
    .map(([id, hash]) => `static/js/${names[id] ?? id}.${hash}.js`)
    .sort()
}

/** 从单个官方分包中提取并去重题目答案。 */
export function extractNeteaseQuestions(source, sourceUrl) {
  const records = new Map()
  for (const match of source.matchAll(QUESTION_PATTERN)) {
    const question = parseStringLiteral(match[2]).trim()
    const answerText = parseStringLiteral(match[3]).trim()
    if (!question || !answerText) continue

    const contentHash = createHash('sha1')
      .update(`${normalizeText(question)}|${normalizeText(answerText)}`)
      .digest('hex')
    if (records.has(contentHash)) continue

    records.set(contentHash, {
      question,
      answerText,
      options: { A: '', B: '', C: '', D: '' },
      category: '网易官方题库',
      subCategory: '',
      categories: ['网易官方题库'],
      source: 'netease',
      sourceUrl,
      sources: [{
        name: 'netease',
        url: sourceUrl,
        category: '网易官方题库',
        subCategory: '',
        keyword: '',
      }],
      confidence: 1,
      occurrenceCount: 1,
      contentHash,
    })
  }
  return [...records.values()]
}

/** 解析形如 `{148:"pagee"}` 的数字键字符串映射。 */
function parseNumericStringMap(source) {
  return Object.fromEntries(
    [...source.matchAll(/(\d+):"([^"]+)"/g)].map((match) => [match[1], match[2]]),
  )
}

/** 使用 JSON 字符串规则还原远程分包中的转义文本。 */
function parseStringLiteral(value) {
  return JSON.parse(value)
}

/** 生成稳定的题目与答案去重文本。 */
function normalizeText(value) {
  return String(value)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[，。！？、；：“”‘’（）【】《》·,.!?;:"'()[\]<>]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}
