import type { AnswerOptionKey, QuestionRecord } from './question'

export interface MatchCandidate {
  question: QuestionRecord
  questionScore: number
  optionScore: number
  confidence: number
}

export interface MatchResult {
  questionId: number
  answer: AnswerOptionKey
  confidence: number
  matchedQuestion: string
  source: string
  category?: string
  candidates: MatchCandidate[]
}
