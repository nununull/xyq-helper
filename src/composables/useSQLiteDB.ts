import type { MatchCandidate } from '../types/match'
import type { ParsedQuestion } from '../types/question'

/**
 * SQLite FTS 的占位封装。MVP 先使用内置题库，后续在这里接入 wasm SQLite。
 */
export function useSQLiteDB() {
  async function initializeQuestionDB(): Promise<void> {
    return Promise.resolve()
  }

  async function searchQuestions(_query: ParsedQuestion, _topK: number): Promise<MatchCandidate[]> {
    return Promise.resolve([])
  }

  return {
    initializeQuestionDB,
    searchQuestions,
  }
}
