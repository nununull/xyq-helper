import type { AnswerOptionKey, QuestionRecord } from './question'

export interface MatchCandidate {
  question: QuestionRecord
  questionScore: number
  optionScore: number
  confidence: number
}

export interface MatchResult {
  questionId: number | string
  answer: AnswerOptionKey | null
  answerText?: string
  confidence: number
  matchedQuestion: string
  source: string
  resultSource?: 'local' | 'cache' | 'remote'
  durationMs?: number
  warning?: string
  category?: string
  candidates: MatchCandidate[]
}
