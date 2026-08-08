import { defineStore } from 'pinia'
import type { MatchCandidate, MatchResult } from '../types/match'
import type { RemoteMatchPreview } from '../types/remoteQuestion'

export const useMatcherStore = defineStore('matcher', {
  state: () => ({
    result: null as MatchResult | null,
    candidates: [] as MatchCandidate[],
    remoteMatches: [] as RemoteMatchPreview[],
    error: '',
  }),
  actions: {
    /** 发布新的匹配结果，并清除上一次尝试遗留的错误。 */
    setResult(result: MatchResult | null) {
      this.result = result
      this.candidates = result?.candidates ?? []
      this.error = ''
    },
    /** 按匹配度保存远程候选，供答案窗口只读展示。 */
    setRemoteMatches(matches: RemoteMatchPreview[]) {
      this.remoteMatches = matches
    },
    /** 发布或清空当前匹配错误。 */
    setError(error: string) {
      this.error = error
    },
    /** 清空匹配结果、候选项和错误，用于切换识别上下文。 */
    clear() {
      this.result = null
      this.candidates = []
      this.remoteMatches = []
      this.error = ''
    },
  },
})
