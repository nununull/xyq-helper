export type AnswerOptionKey = 'A' | 'B' | 'C' | 'D'

export interface ParsedQuestion {
  questionText: string
  options: Partial<Record<AnswerOptionKey, string>>
  normalizedQuestion: string
  normalizedOptions: string
  rawText: string
}

export interface QuestionRecord {
  id: number
  question: string
  normalizedQuestion: string
  options: Record<AnswerOptionKey, string>
  normalizedOptions: string
  answer?: AnswerOptionKey
  answerText?: string
  category: string
  source: string
}

export interface UserQuestionRecord {
  id?: number
  baseKey?: string
  question: string
  options: Record<AnswerOptionKey, string>
  answer?: AnswerOptionKey
  answerText?: string
  category: string
  source: 'manual' | '175dt'
  createdAt: string
  updatedAt: string
  revision: number
}

export interface QuestionBankPackage {
  format: 'xyq-question-bank'
  schemaVersion: 1
  mode: 'full' | 'patch'
  name: string
  version: string
  exportedAt: string
  questions?: QuestionRecord[]
  changes: UserQuestionRecord[]
}

export interface UnknownQuestion {
  id?: number
  question: string
  options: Partial<Record<AnswerOptionKey, string>>
  ocrConfidence: number
  category?: string
  screenshotHash?: string
  createdAt: string
  status: 'pending' | 'ignored' | 'confirmed'
}
