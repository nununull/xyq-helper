import type { ParsedQuestion } from '../../types/question'
import type { RankedRemoteCandidate, RemoteQuestionCandidate } from '../../types/remoteQuestion'
import { diceSimilarity, normalizeQuestionText } from '../../utils/normalizeText'

export interface RemoteMatchDecision {
  kind: 'confident' | 'lowConfidence' | 'ambiguous' | 'rejected'
  best: RankedRemoteCandidate | null
  candidates: RankedRemoteCandidate[]
}

/** 对远程候选题排序，并根据阈值判断结果是否可直接展示。 */
export function rankRemoteCandidates(
  parsed: ParsedQuestion,
  candidates: RemoteQuestionCandidate[],
  ocrConfidence: number,
): RemoteMatchDecision {
  const ranked = candidates
    .map((candidate) => {
      const inferred = inferRemoteAnswer(candidate.answerText, parsed.options)
      const questionScore = diceSimilarity(parsed.questionText, candidate.question)
      const confidence = questionScore * 0.7 + inferred.score * 0.2 + ocrConfidence * 0.1

      return {
        ...candidate,
        answer: inferred.answer,
        questionScore,
        optionScore: inferred.score,
        confidence,
      }
    })
    .sort((left, right) => right.confidence - left.confidence)

  const best = ranked[0] ?? null
  if (!best || best.confidence < 0.68) {
    return { kind: 'rejected', best, candidates: ranked }
  }
  if (ranked[1] && best.confidence - ranked[1].confidence < 0.05) {
    return { kind: 'ambiguous', best, candidates: ranked }
  }

  return {
    kind: best.confidence >= 0.82 ? 'confident' : 'lowConfidence',
    best,
    candidates: ranked,
  }
}

/** 将答案文本与本次 OCR 选项比较，无法可靠对应时返回空字母。 */
export function inferRemoteAnswer(
  answerText: string,
  options: ParsedQuestion['options'],
): { answer: RankedRemoteCandidate['answer']; score: number } {
  let answer: RankedRemoteCandidate['answer'] = null
  let score = 0
  // 175DT 的答案可能带空格、装饰符号和“参考答案”等前缀，比较前统一清理。
  const normalizedAnswer = normalizeQuestionText(answerText)
    .replace(/^(?:参考|正确)?答案(?:是|为)?/, '')

  for (const [key, optionText] of Object.entries(options)) {
    const normalizedOption = normalizeQuestionText(optionText ?? '')
    const current = normalizedOption && normalizedAnswer === normalizedOption
      ? 1
      : diceSimilarity(normalizedAnswer, normalizedOption)
    if (current > score) {
      answer = key as RankedRemoteCandidate['answer']
      score = current
    }
  }

  return score >= 0.5 ? { answer, score } : { answer: null, score }
}
