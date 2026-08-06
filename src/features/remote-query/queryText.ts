import { normalizeQuestionText } from '../../utils/normalizeText'

const genericWords = new Set(['以下', '哪个', '什么', '正确', '错误', '属于', '说法', '的是'])

/** 清理 OCR 题干，使其适合作为远程接口的主查询文本。 */
export function cleanRemoteQueryText(text: string): string {
  return text
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+[ABCD][.。:：、]\s*.*$/i, '')
    .replace(/[|丨¦]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/([，。！？；：]) /g, '$1')
    .trim()
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

/** 从题干中选择唯一的高信息量降级关键词。 */
export function selectFallbackKeyword(text: string): string | null {
  const quoted = text.match(/[“”"《》]([^“”"《》]{2,8})[“”"《》]/)?.[1]
  if (quoted && !genericWords.has(quoted)) {
    return quoted
  }

  const candidates = normalizeQuestionText(text)
    .split(/(?:以下|哪个|什么|正确|错误|属于|说法|的是|中|被称为)/)
    .map((part) => part.replace(/[^\u3400-\u9fff0-9]/g, ''))
    .filter((part) => part.length >= 2 && part.length <= 4 && !genericWords.has(part))

  return candidates.sort((left, right) => right.length - left.length)[0] ?? null
}
