import type { ParsedQuestion } from '../../types/question'
import { diceSimilarity } from '../../utils/normalizeText'

/** 创建连续 OCR 题目稳定器，只有相邻结果足够相似时才放行。 */
export function createQuestionStabilizer(requiredSimilarity = 0.9) {
  let previous: ParsedQuestion | null = null

  return {
    /** 记录一次 OCR 结果，并在连续稳定时返回当前题目。 */
    push(current: ParsedQuestion): ParsedQuestion | null {
      const stable = previous
        && diceSimilarity(previous.normalizedQuestion, current.normalizedQuestion) >= requiredSimilarity

      previous = current
      return stable ? current : null
    },
    /** 清除上一帧，防止分类或共享源变化后误判。 */
    reset(): void {
      previous = null
    },
  }
}