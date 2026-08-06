import { defineStore } from 'pinia'
import type { MatchCandidate, MatchResult } from '../types/match'
import type { RemoteAmbiguousCandidate } from '../types/remoteQuestion'

export const useMatcherStore = defineStore('matcher', {
  state: () => ({
    result: null as MatchResult | null,
    candidates: [] as MatchCandidate[],
    remoteCandidates: [] as RemoteAmbiguousCandidate[],
    error: '',
  }),
  actions: {
    /** 发布新的匹配结果，并清除上一次尝试遗留的错误。 */
    setResult(result: MatchResult | null) {
      this.result = result
      this.candidates = result?.candidates ?? []
      this.remoteCandidates = []
      this.error = ''
    },
    /** 发布远程歧义候选，并确保其不会被当作确定答案。 */
    setRemoteCandidates(candidates: RemoteAmbiguousCandidate[]) {
      if (candidates.length > 0) {
        this.result = null
        this.candidates = []
      }
      this.remoteCandidates = candidates
    },
    /** 发布或清空当前匹配错误。 */
    setError(error: string) {
      this.error = error
    },
    /** 清空匹配结果、候选项和错误，用于切换识别上下文。 */
    clear() {
      this.result = null
      this.candidates = []
      this.remoteCandidates = []
      this.error = ''
    },
  },
})
