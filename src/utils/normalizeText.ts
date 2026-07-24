/**
 * 将 OCR 文本归一化为适合检索和相似度计算的紧凑字符串。
 */
export function normalizeQuestionText(text: string): string {
  return text
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/[，。！？、；：“”‘’（）【】《》·,.!?;:"'()[\]<>]/g, '')
    .replace(/\s+/g, '')
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
