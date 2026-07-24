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
