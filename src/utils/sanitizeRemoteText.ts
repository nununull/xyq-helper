const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '…',
  ldquo: '“',
  lt: '<',
  mdash: '—',
  middot: '·',
  nbsp: ' ',
  ndash: '–',
  quot: '"',
  rdquo: '”',
}

/** 解码 175DT 文本中的常见命名实体和数字实体。 */
function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      const point = Number.parseInt(code.slice(2), 16)
      return Number.isFinite(point) ? String.fromCodePoint(point) : entity
    }
    if (code.startsWith('#')) {
      const point = Number.parseInt(code.slice(1), 10)
      return Number.isFinite(point) ? String.fromCodePoint(point) : entity
    }
    return HTML_ENTITIES[code.toLowerCase()] ?? entity
  })
}

/** 清洗远程题目与答案，保留有语义的中文标点并移除网页噪声。 */
export function sanitizeRemoteText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/\uFFFD/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[◆◇★☆●○•▪■□▶▷►※]+\s*/, '')
    .replace(/\s*[◆◇★☆●○•▪■□▶▷►※]+$/, '')
    .trim()
}

/** 清洗远程答案，并移除接口偶尔附带的“答案”标签。 */
export function sanitizeRemoteAnswer(value: string): string {
  return sanitizeRemoteText(value).replace(/^答案\s*[:：]\s*/, '').trim()
}
