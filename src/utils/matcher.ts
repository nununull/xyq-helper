import type { MatchCandidate, MatchResult } from '../types/match'
import type { ParsedQuestion, QuestionRecord } from '../types/question'
import { diceSimilarity } from './normalizeText'

export const demoQuestions: QuestionRecord[] = [
  {
    id: 1,
    question: '下列关于唐朝诗人李白的说法错误的是？',
    normalizedQuestion: '下列关于唐朝诗人李白的说法错误的是',
    options: {
      A: '他出生于碎叶城',
      B: '他号称诗仙',
      C: '他是浪漫主义诗人',
      D: '他与杜甫并称李杜',
    },
    normalizedOptions: 'A他出生于碎叶城B他号称诗仙C他是浪漫主义诗人D他与杜甫并称李杜',
    answer: 'A',
    category: '科举',
    source: 'demo',
  },
  {
    id: 2,
    question: '梦幻西游中常见的科举答题可以使用数字键选择答案吗？',
    normalizedQuestion: '梦幻西游中常见的科举答题可以使用数字键选择答案吗',
    options: {
      A: '可以',
      B: '不可以',
      C: '只能鼠标',
      D: '只能自动选择',
    },
    normalizedOptions: 'A可以B不可以C只能鼠标D只能自动选择',
    answer: 'A',
    category: '科举',
    source: 'demo',
  },
]

/**
 * 使用题干相似度和选项相似度对候选题排序。
 */
export function matchQuestion(
  parsed: ParsedQuestion,
  questions: QuestionRecord[] = demoQuestions,
  minConfidence = 0.45,
): MatchResult | null {
  const candidates = questions
    .map((question) => {
      const questionScore = diceSimilarity(parsed.normalizedQuestion, question.normalizedQuestion)
      const optionScore = diceSimilarity(parsed.normalizedOptions, question.normalizedOptions)
      const confidence = questionScore * 0.75 + optionScore * 0.25

      return { question, questionScore, optionScore, confidence } satisfies MatchCandidate
    })
    .sort((left, right) => right.confidence - left.confidence)

  const best = candidates[0]
  if (!best || best.confidence < minConfidence) {
    return null
  }

  return {
    questionId: best.question.id,
    answer: best.question.answer,
    confidence: best.confidence,
    matchedQuestion: best.question.question,
    source: best.question.source,
    category: best.question.category,
    candidates,
  }
}
