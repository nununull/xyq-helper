import { defineStore } from 'pinia'
import type { RecognitionPhase } from '../types/remoteQuestion'

type ResultSource = 'local' | 'cache' | 'remote' | null

const initialState = () => ({
  phase: 'idle' as RecognitionPhase,
  message: '',
  running: false,
  lastCompletedFingerprint: null as string | null,
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
    /** 将识别状态恢复为初始值。 */
    reset() {
      Object.assign(this, initialState())
    },
  },
})