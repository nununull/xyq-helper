import type { AnswerOptionKey } from './question'

export interface ActivityCategory {
  id: string
  name: string
}

export interface ActivityCategoryGroup {
  name: string
  categories: ActivityCategory[]
}

export interface RemoteQuestionCandidate {
  question: string
  answerText: string
  source: '175dt'
}

export type RemoteQueryFailureKind =
  | 'corsBlocked'
  | 'timeout'
  | 'rateLimited'
  | 'remoteError'
  | 'malformedResponse'

export type RemoteQueryResult =
  | { kind: 'success'; candidates: RemoteQuestionCandidate[] }
  | { kind: 'empty'; candidates: [] }
  | { kind: RemoteQueryFailureKind; message: string; status?: number }

export interface RemoteQueryOptions {
  signal?: AbortSignal
  timeoutMs?: number
  fetcher?: typeof fetch
}

export interface RankedRemoteCandidate extends RemoteQuestionCandidate {
  answer: AnswerOptionKey | null
  questionScore: number
  optionScore: number
  confidence: number
}

export interface RemoteAmbiguousCandidate {
  question: string
  answerText: string
  confidence: number
}

export interface RemoteQuestionCache {
  id: string
  categoryId: string
  questionFingerprint: string
  recognizedQuestion: string
  matchedQuestion: string
  answerText: string
  source: string
  matchConfidence: number
  createdAt: number
  lastUsedAt: number
  hitCount: number
}

export type RecognitionPhase =
  | 'idle'
  | 'capturing'
  | 'recognizing'
  | 'stabilizing'
  | 'cacheLookup'
  | 'primaryQuery'
  | 'fallbackQuery'
  | 'matching'
  | 'showingAnswer'
  | 'waitingRetry'
  | 'paused'
