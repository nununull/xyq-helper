import { defineStore } from 'pinia'
import type { UnknownQuestion } from '../types/question'
import { listUnknownQuestions, saveUnknownQuestion } from '../composables/useLocalStorageDB'

export const useDBStore = defineStore('db', {
  state: () => ({
    ready: true,
    questionCount: 2,
    version: 'demo-local',
    unknownQuestions: [] as UnknownQuestion[],
    error: '',
  }),
  actions: {
    async refreshUnknownQuestions() {
      this.unknownQuestions = await listUnknownQuestions()
    },
    async addUnknownQuestion(question: UnknownQuestion) {
      await saveUnknownQuestion(question)
      await this.refreshUnknownQuestions()
    },
  },
})
