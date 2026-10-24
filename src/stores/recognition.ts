import { defineStore } from 'pinia'
import type { RecognitionPhase, RemoteQuestionCandidate } from '../types/remoteQuestion'

export const useRecognitionStore = defineStore('recognition', {
  state: () => ({
    phase: 'idle' as RecognitionPhase,
    message: '',
    running: false,
    candidates: [] as RemoteQuestionCandidate[],
    durationMs: null as number | null,
    requestCount: 0,
  }),
  actions: {
    /** 同步当前识别阶段和面向用户的提示。 */
    setPhase(phase: RecognitionPhase, message: string) {
      this.phase = phase
      this.message = message
    },
    /** 同步本地画面监测是否运行。 */
    setRunning(running: boolean) {
      this.running = running
    },
    /** 保存175dt原始候选顺序，所有答案界面都从这里单向派生。 */
    publishResult(candidates: RemoteQuestionCandidate[], durationMs: number) {
      this.candidates = candidates
      this.durationMs = durationMs
    },
    /** 换题或停止时立即撤下旧答案。 */
    clearResult() {
      this.candidates = []
      this.durationMs = null
    },
    /** 统计实际发出的识别请求，不把本地抽帧计入查询次数。 */
    recordRequest() {
      this.requestCount += 1
    },
  },
})
