import type { ParsedQuestion } from '../../types/question'
import { diceSimilarity } from '../../utils/normalizeText'

export type QuestionStabilityResult =
  | { kind: 'firstFrame'; question: ParsedQuestion }
  | {
    kind: 'switched' | 'stable' | 'forcedStable'
    question: ParsedQuestion
    previousQuestion: ParsedQuestion
    similarity: number
  }

/** 创建连续 OCR 题目稳定器，在 OCR 持续波动时使用最新有效结果兜底放行。 */
export function createQuestionStabilizer(
  requiredSimilarity = 0.9,
  maximumPendingFrames = 3,
) {
  let previous: ParsedQuestion | null = null
  let pendingFrames = 0

  return {
    /** 记录一次 OCR 结果，并明确返回首帧、换题或稳定状态。 */
    push(current: ParsedQuestion): QuestionStabilityResult {
      if (!previous) {
        previous = current
        pendingFrames = 1
        return { kind: 'firstFrame', question: current }
      }

      const previousQuestion = previous
      const similarity = diceSimilarity(
        previous.normalizedQuestion,
        current.normalizedQuestion,
      )

      previous = current
      if (similarity >= requiredSimilarity) {
        pendingFrames = 0
        return {
          kind: 'stable',
          question: current,
          previousQuestion,
          similarity,
        }
      }

      pendingFrames += 1
      const canForceStable = pendingFrames >= maximumPendingFrames
        && current.normalizedQuestion.length >= 4
      if (canForceStable) pendingFrames = 0
      return {
        kind: canForceStable ? 'forcedStable' : 'switched',
        question: current,
        previousQuestion,
        similarity,
      }
    },
    /** 清除上一帧，防止分类或共享源变化后误判。 */
    reset(): void {
      previous = null
      pendingFrames = 0
    },
  }
}
