import type { ParsedQuestion } from '../../types/question'
import { diceSimilarity } from '../../utils/normalizeText'

export type QuestionStabilityResult =
  | { kind: 'firstFrame'; question: ParsedQuestion }
  | {
    kind: 'switched' | 'stable'
    question: ParsedQuestion
    previousQuestion: ParsedQuestion
    similarity: number
  }

/** 创建连续 OCR 题目稳定器，只有相邻结果足够相似时才放行。 */
export function createQuestionStabilizer(requiredSimilarity = 0.9) {
  let previous: ParsedQuestion | null = null

  return {
    /** 记录一次 OCR 结果，并明确返回首帧、换题或稳定状态。 */
    push(current: ParsedQuestion): QuestionStabilityResult {
      if (!previous) {
        previous = current
        return { kind: 'firstFrame', question: current }
      }

      const previousQuestion = previous
      const similarity = diceSimilarity(
        previous.normalizedQuestion,
        current.normalizedQuestion,
      )

      previous = current
      return {
        kind: similarity >= requiredSimilarity ? 'stable' : 'switched',
        question: current,
        previousQuestion,
        similarity,
      }
    },
    /** 清除上一帧，防止分类或共享源变化后误判。 */
    reset(): void {
      previous = null
    },
  }
}
