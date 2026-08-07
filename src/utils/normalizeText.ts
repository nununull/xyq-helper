/**
 * 将 OCR 文本归一化为适合检索和相似度计算的紧凑字符串。
 */
export function normalizeQuestionText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[^\p{Script=Han}\p{L}\p{N}]/gu, '')
    .toLowerCase()
}

/**
 * 计算两个短文本的字符 Dice 相似度，适合 OCR 噪声下的题目粗匹配。
 */
export function diceSimilarity(left: string, right: string): number {
  const a = normalizeQuestionText(left)
  const b = normalizeQuestionText(right)

  if (!a || !b) {
    return 0
  }

  if (a === b) {
    return 1
  }

  const grams = new Map<string, number>()
  for (let index = 0; index < a.length - 1; index += 1) {
    const gram = a.slice(index, index + 2)
    grams.set(gram, (grams.get(gram) ?? 0) + 1)
  }

  let overlap = 0
  for (let index = 0; index < b.length - 1; index += 1) {
    const gram = b.slice(index, index + 2)
    const count = grams.get(gram) ?? 0
    if (count > 0) {
      overlap += 1
      grams.set(gram, count - 1)
    }
  }

  return (2 * overlap) / Math.max(1, a.length + b.length - 2)
}

const ocrConfusionGroups = [
  '人入', '己已巳', '未末', '土士', '日曰目', '问间', '谁淮', '天夫',
  '木本术', '王玉', '侯候', '辨辩瓣', '史吏', '千干于', '诗持', '口囗',
]
const ocrConfusionMap = new Map<string, number>()
for (const group of ocrConfusionGroups) {
  for (const left of group) {
    for (const right of group) {
      if (left !== right) ocrConfusionMap.set(`${left}${right}`, 0.25)
    }
  }
}

/** 使用形近字低代价编辑距离衡量 OCR 文本与标准题干的相似度。 */
export function ocrTextSimilarity(left: string, right: string): number {
  const source = normalizeQuestionText(left)
  const target = normalizeQuestionText(right)
  if (!source || !target) return 0
  if (source === target) return 1

  let previous = Array.from({ length: target.length + 1 }, (_, index) => index)
  for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex += 1) {
    const current = [sourceIndex]
    for (let targetIndex = 1; targetIndex <= target.length; targetIndex += 1) {
      const sourceCharacter = source[sourceIndex - 1]
      const targetCharacter = target[targetIndex - 1]
      const substitutionCost = sourceCharacter === targetCharacter
        ? 0
        : (ocrConfusionMap.get(`${sourceCharacter}${targetCharacter}`) ?? 1)
      current[targetIndex] = Math.min(
        previous[targetIndex] + 1,
        current[targetIndex - 1] + 1,
        previous[targetIndex - 1] + substitutionCost,
      )
    }
    previous = current
  }

  const distance = previous[target.length] ?? Math.max(source.length, target.length)
  return Math.max(0, 1 - distance / Math.max(source.length, target.length))
}
