import { defineStore } from 'pinia'
import type { RecognitionPhase } from '../types/remoteQuestion'

type ResultSource = 'local' | 'cache' | 'remote' | null

/** 创建识别状态的初始值，供 Store 初始化和重置复用。 */
const initialState = () => ({
  phase: 'idle' as RecognitionPhase,
  message: '',
  running: false,
  cacheGeneration: 0,
  lastCompletedFingerprint: null as string | null,
  lastCompletedQuestion: null as string | null,
  resultSource: null as ResultSource,
  durationMs: null as number | null,
})

export const useRecognitionStore = defineStore('recognition', {
  state: initialState,
  actions: {
    /** 设置识别流程当前所处的阶段。 */
    setPhase(phase: RecognitionPhase) {
      this.phase = phase
    },
    /** 设置展示给用户的识别状态消息。 */
    setMessage(message: string) {
      this.message = message
    },
    /** 设置识别流程是否正在执行。 */
    setRunning(running: boolean) {
      this.running = running
    },
    /** 记录最近一次完成识别的题目指纹。 */
    setLastCompletedFingerprint(fingerprint: string | null) {
      this.lastCompletedFingerprint = fingerprint
    },
    /** 记录最近一次完成识别的标准化题干。 */
    setLastCompletedQuestion(question: string | null) {
      this.lastCompletedQuestion = question
    },
    /** 递增远程缓存代次，并清除已完成题的内存语义。 */
    invalidateRemoteCache() {
      this.cacheGeneration += 1
      this.lastCompletedFingerprint = null
      this.lastCompletedQuestion = null
      this.resultSource = null
      this.durationMs = null
      this.phase = this.running ? 'capturing' : 'idle'
      this.message = this.running ? '缓存已清理，等待重新识别' : ''
    },
    /** 将识别状态恢复为初始值。 */
    reset() {
      const cacheGeneration = this.cacheGeneration
      Object.assign(this, initialState())
      this.cacheGeneration = cacheGeneration
    },
  },
})
