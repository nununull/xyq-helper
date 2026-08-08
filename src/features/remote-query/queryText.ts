import { diceSimilarity, normalizeQuestionText } from '../../utils/normalizeText'
import { tokenizeChineseQuery } from './chineseTokenizer'

const genericWords = new Set([
  '以下', '下列', '哪个', '哪种', '哪项', '哪位', '什么', '正确', '错误', '属于',
  '说法', '的是', '谁', '哪些', '如何', '为什么', '是否', '题目', '答案',
  '城市', '工具',
])
const questionScaffolds = [
  '被称为', '为什么', '的是', '以下', '下列', '哪个', '哪种', '哪项',
  '哪位', '哪些', '什么', '正确', '错误', '属于', '说法', '称为', '如何',
  '是否', '中', '的', '是', '吗',
]
const searchTokenPattern = /[a-z0-9]+(?:[._+-][a-z0-9]+)*|[㐀-鿿]/giu
const weakInformationCharacters = new Set('的是了在和与或为有中上下列以哪什么谁否吗呢项个种位说法正确错误属于关于')
const maximumProgressiveQueryCount = 5

export interface SimilarQuestionEntry<T> {
  normalizedQuestion: string
  value: T
}

/** 在题目记录中查找相似度严格大于阈值的最佳项。 */
export function findSimilarQuestionEntry<T>(
  normalizedQuestion: string,
  entries: Iterable<SimilarQuestionEntry<T>>,
  threshold = 0.95,
): SimilarQuestionEntry<T> | null {
  let best: SimilarQuestionEntry<T> | null = null
  let bestSimilarity = threshold

  for (const entry of entries) {
    const similarity = diceSimilarity(normalizedQuestion, entry.normalizedQuestion)
    if (similarity > bestSimilarity) {
      best = entry
      bestSimilarity = similarity
    }
  }

  return best
}

/** 清理 OCR 题干，使其适合作为远程接口的主查询文本。 */
export function cleanRemoteQueryText(text: string): string {
  return text
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+[ABCD][.。:：、]\s*.*$/i, '')
    .replace(/[|丨¦]+/g, '')
    .replace(/[《》〈〉（）()【】\[\]<>]+/g, '')
    .replace(/([㐀-鿿])\s+(?=[㐀-鿿])/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/([，。！？；：]) /g, '$1')
    .trim()
}

/** 生成长度受控且保留高信息关键词上下文的远程主查询文本。 */
export function createCompactRemoteQueryText(text: string, maximumLength = 14): string {
  const cleaned = cleanRemoteQueryText(text)
  if (cleaned.length <= maximumLength) return cleaned
  if (cleaned.length <= maximumLength * 2) return takeSearchTokens(cleaned, maximumLength)

  const keyword = selectFallbackKeyword(cleaned)
  return keyword ?? takeSearchTokens(cleaned, maximumLength)
}

/**
 * 将题干规划成短词组与独立实体词，兼顾召回精度和 OCR 错字容忍度。
 * 只有短题干会整体查询，避免长文本中的一个错字让 175DT 完全无法命中。
 */
export async function createProgressiveRemoteQueries(
  text: string,
  maximumLength = 10,
): Promise<string[]> {
  const cleaned = cleanRemoteQueryText(text)
  const compact = tokenizeSearchText(cleaned).join('')
  if (!compact) return []

  const queries: string[] = []
  const normalizedQueries = new Set<string>()
  const words = await tokenizeChineseQuery(cleaned)

  // 短题干本身足够精确；长题干不再整段发送，避免一个 OCR 错字导致整次查询失效。
  if (compact.length <= maximumLength) {
    appendUniqueQuery(queries, normalizedQueries, cleaned)
  }

  // 先查短而有上下文的词组，再查互相独立的实体词，使单个错字只影响其中一路召回。
  for (const phrase of selectDiscriminativePhrases(words, Math.min(maximumLength, 8), 2)) {
    appendUniqueQuery(queries, normalizedQueries, phrase)
  }

  // 优先保留规则实体的请求名额，补充分词器未能识别的书名、人名和数字量词。
  appendUniqueQuery(queries, normalizedQueries, selectFallbackKeyword(cleaned))
  for (const keyword of selectDiscriminativeWords(words, 3)) {
    appendUniqueQuery(queries, normalizedQueries, keyword)
  }
  return queries.slice(0, maximumProgressiveQueryCount)
}

/** 按标准化检索语义去重，避免标点和空格差异浪费请求。 */
function appendUniqueQuery(
  queries: string[],
  normalizedQueries: Set<string>,
  query: string | null,
): void {
  const value = query?.trim()
  if (!value) return

  const normalized = normalizeQuestionText(value)
  if (!normalized || normalizedQueries.has(normalized)) return

  normalizedQueries.add(normalized)
  queries.push(value)
}

/**
 * 沿自然词边界生成多尺度连续短语，并选择彼此分散的高信息候选。
 * 保持连续子串兼容远端模糊搜索，同时避免固定字符窗口切断实体词。
 */
function selectDiscriminativePhrases(
  words: string[],
  maximumLength: number,
  limit: number,
): string[] {
  const normalizedWords = words
    .map((word) => normalizeQuestionText(word))
    .filter(Boolean)
  const textLength = normalizedWords.join('').length
  const upperLength = Math.max(4, maximumLength)
  const lowerLength = Math.min(4, upperLength)
  const candidates: Array<{ value: string; start: number; end: number; score: number }> = []

  for (let start = 0; start < normalizedWords.length; start += 1) {
    let value = ''
    for (let end = start; end < normalizedWords.length; end += 1) {
      value += normalizedWords[end]
      if (value.length > upperLength) break
      if (value.length < lowerLength) continue
      candidates.push({
        value,
        start,
        end: end + 1,
        score: scoreQueryPhrase(value, start, end + 1, normalizedWords, textLength),
      })
    }
  }
  candidates.sort((left, right) => right.score - left.score || left.start - right.start)

  const selected: typeof candidates = []
  for (const candidate of candidates) {
    const overlapsHeavily = selected.some((current) => (
      calculateRangeOverlap(candidate.start, candidate.end, current.start, current.end) >= 0.6
    ))
    if (overlapsHeavily) continue
    selected.push(candidate)
    if (selected.length === limit) break
  }

  return selected.map((candidate) => candidate.value)
}

/**
 * 选择含义不重复的自然词作为独立查询锚点。
 * 锚点彼此不拼接，因此题干某处出现错别字时，其余正确词仍能从 175DT 召回候选。
 */
function selectDiscriminativeWords(words: string[], limit: number): string[] {
  const candidates = words
    .map((word, order) => ({ value: normalizeQuestionText(word), order }))
    .filter((candidate) => candidate.value.length >= 2 && candidate.value.length <= 8)
    .filter((candidate) => isUsefulKeyword(candidate.value))
    .map((candidate) => ({
      ...candidate,
      score: scoreQueryWord(candidate.value),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.order - right.order)

  const selected: typeof candidates = []
  for (const candidate of candidates) {
    const duplicatesMeaning = selected.some((current) => (
      current.value.includes(candidate.value) || candidate.value.includes(current.value)
    ))
    if (duplicatesMeaning) continue
    selected.push(candidate)
    if (selected.length === limit) break
  }

  return selected.map((candidate) => candidate.value)
}

/** 依据有效字符密度与实体特征为单词查询评分。 */
function scoreQueryWord(value: string): number {
  let informativeCharacters = 0
  let score = Math.min(value.length, 6) * 2
  for (const character of value) {
    if (/[a-z0-9]/i.test(character)) {
      informativeCharacters += 1
      score += 3
    } else if (weakInformationCharacters.has(character)) {
      score -= 2
    } else {
      informativeCharacters += 1
      score += 2
    }
  }
  if (/[鬼诗朝代史名书国学战发明宗]/.test(value)) score += 4
  return informativeCharacters >= 2 ? score : 0
}

/** 依据实词密度、自然词完整度和题干位置为连续查询短语评分。 */
function scoreQueryPhrase(
  value: string,
  start: number,
  end: number,
  words: string[],
  textLength: number,
): number {
  let score = 0
  for (const character of value) {
    if (/[a-z0-9]/i.test(character)) score += 4
    else if (!weakInformationCharacters.has(character)) score += 2
    else score -= 1
  }
  if (/[㐀-鿿]{2,}/.test(value)) score += 2
  for (const word of words.slice(start, end)) {
    if (word.length >= 2 && isUsefulKeyword(word)) score += Math.min(word.length, 4) * 1.5
  }
  // 轻微偏向题干中部，避免总是取到“以下哪个”等固定开头或语气结尾。
  const prefixLength = words.slice(0, start).join('').length
  const center = prefixLength + value.length / 2
  score -= Math.abs(center - textLength / 2) / Math.max(1, textLength)
  return score
}

/** 计算两个词元区间相对较短区间的重叠比例。 */
function calculateRangeOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): number {
  const overlap = Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart))
  return overlap / Math.max(1, Math.min(leftEnd - leftStart, rightEnd - rightStart))
}

/** 将连续英文、数字及常见版本连接符合并为不可拆分的搜索单元。 */
function tokenizeSearchText(text: string): string[] {
  return text.match(searchTokenPattern) ?? []
}

/** 按搜索单元截断文本，避免从英文单词或连续数字中间切断。 */
function takeSearchTokens(text: string, maximumLength: number): string {
  return tokenizeSearchText(text).slice(0, maximumLength).join('')
}

/** 为分类内的标准化题干生成稳定且紧凑的本地缓存指纹。 */
export function createQuestionFingerprint(text: string): string {
  const normalized = normalizeQuestionText(text)
  let hash = 2166136261
  for (const char of normalized) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

/** 从题干中按明确优先级选择唯一的高信息量降级关键词。 */
export function selectFallbackKeyword(text: string): string | null {
  const quoted = extractQuotedKeyword(text)
  if (quoted && containsChinese(quoted)) return quoted

  const normalized = normalizeQuestionText(text)
  const entity = extractEntityKeyword(normalized)
  if (entity) return entity

  const quantity = normalized.match(/[0-9零〇一二三四五六七八九十百千万两]+(?:个|位|名|年|次|种|只|条|本|部|座|枚|件|岁|天|月|日)/)?.[0]
  if (quantity && isUsefulKeyword(quantity)) return quantity

  const naturalWord = selectNaturalChineseWord(text)
  if (naturalWord) return naturalWord

  const chineseWindow = selectHighInformationWindow(normalized)
  if (chineseWindow) return chineseWindow

  if (quoted) return quoted
  return selectAsciiKeyword(text)
}

/** 使用浏览器中文分词词典选择自然中文词组，避免域名或长数字抢占查询关键词。 */
function selectNaturalChineseWord(text: string): string | null {
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
  const candidates = [...segmenter.segment(text)]
    .filter((item) => item.isWordLike)
    .map((item) => item.segment.replace(/[^㐀-鿿]/g, ''))
    .filter((word) => isUsefulKeyword(word))
    .map((word, order) => ({
      word,
      order,
      score: word.length * 10 + (/[鬼诗朝代史名书国学战发明宗]/.test(word) ? 4 : 0),
    }))
    .sort((left, right) => right.score - left.score || left.order - right.order)

  return candidates[0]?.word ?? null
}

/** 在没有可用中文词时选择完整英文、数字、域名或版本号。 */
function selectAsciiKeyword(text: string): string | null {
  const candidates = tokenizeSearchText(text)
    .filter((token) => /[a-z0-9]/i.test(token))
    .filter((token) => isUsefulKeyword(token))
    .map((keyword, order) => ({
      keyword,
      order,
      score: keyword.length + (/[._+-]/.test(keyword) ? 8 : 0),
    }))
    .sort((left, right) => right.score - left.score || left.order - right.order)

  return candidates[0]?.keyword ?? null
}

/** 判断文本中是否包含中文字符。 */
function containsChinese(text: string): boolean {
  return /[㐀-鿿]/.test(text)
}

/** 按成对引号与书名号的优先级提取专有内容。 */
function extractQuotedKeyword(text: string): string | null {
  const quotedPatterns = [
    /“([^”]{2,32})”/,
    /"([^"]{2,32})"/,
    /《([^》]{2,32})》/,
    /「([^」]{2,32})」/,
    /『([^』]{2,32})』/,
  ]
  for (const pattern of quotedPatterns) {
    const candidate = pattern.exec(text)?.[1]?.trim()
    if (candidate && isUsefulKeyword(candidate)) return candidate
  }
  return null
}

/** 从无引号题干中提取人名、朝代或专名词组。 */
function extractEntityKeyword(normalized: string): string | null {
  const definitionSubject = normalized.match(/^([㐀-鿿]{2,6})(?=是|为|指)/)?.[1]
  if (definitionSubject && isUsefulKeyword(definitionSubject)) return definitionSubject

  const roleName = normalized.match(
    /(?:诗人|词人|作家|文学家|书法家|画家|名将|科学家|发明家)([㐀-鿿]{2,4})(?=被|为|是|曾|创|撰|发|的|$)/,
  )?.[1]
  if (roleName && isUsefulKeyword(roleName)) return roleName

  const contextualPerson = normalized.match(
    /(?:朝|代|时期)([㐀-鿿]{2,4})(?=所著|所作|创作|提出|被|曾)/,
  )?.[1]
  if (contextualPerson && isUsefulKeyword(contextualPerson)) return contextualPerson

  const namedTopic = normalized.match(
    /([㐀-鿿]{1,2}(?:发明|名著|战争|运动|制度|学说|建筑|节气|生肖))/,
  )?.[1]
  if (namedTopic && isUsefulKeyword(namedTopic)) return namedTopic

  const dynasty = normalized.match(/(?:西周|东周|西汉|东汉|西晋|东晋|北宋|南宋|[夏商周秦汉晋隋唐宋元明清])(?:朝|代)/)?.[0]
  return dynasty && isUsefulKeyword(dynasty) ? dynasty : null
}

/** 从长片段中选择唯一的 2～4 字高信息窗口。 */
function selectHighInformationWindow(normalized: string): string | null {
  const separator = new RegExp(questionScaffolds.join('|'), 'g')
  const fragments = normalized
    .replace(separator, ' ')
    .split(/\s+/)
    .map((part) => part.replace(/[^㐀-鿿0-9]/g, ''))
    .filter((part) => part.length >= 2 && containsChinese(part))
  const candidates: Array<{ keyword: string; score: number; order: number }> = []
  let order = 0

  for (const fragment of fragments) {
    const maximumLength = Math.min(4, fragment.length)
    for (let length = maximumLength; length >= 2; length -= 1) {
      for (let index = 0; index <= fragment.length - length; index += 1) {
        const keyword = fragment.slice(index, index + length)
        if (!isUsefulKeyword(keyword)) continue
        const score = length * 10
          + (/[鬼诗朝代史名书国学战发明宗]/.test(keyword) ? 4 : 0)
        candidates.push({ keyword, score, order: order++ })
      }
    }
  }

  candidates.sort((left, right) => right.score - left.score || left.order - right.order)
  return candidates[0]?.keyword ?? null
}

/** 过滤通用问句词和信息量不足的候选。 */
function isUsefulKeyword(keyword: string): boolean {
  const tokenCount = tokenizeSearchText(keyword).length
  return keyword.length >= 2
    && keyword.length <= 32
    && tokenCount >= 1
    && tokenCount <= 8
    && !genericWords.has(keyword)
    && ![...genericWords].some((word) => keyword.includes(word))
    && !questionScaffolds.includes(keyword)
}
