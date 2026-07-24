import { defineStore } from 'pinia'
import type { MatchCandidate, MatchResult } from '../types/match'

export const useMatcherStore = defineStore('matcher', {
  state: () => ({
    result: null as MatchResult | null,
    candidates: [] as MatchCandidate[],
    error: '',
  }),
  actions: {
    setResult(result: MatchResult | null) {
      this.result = result
      this.candidates = result?.candidates ?? []
    },
    setError(error: string) {
      this.error = error
    },
  },
})
