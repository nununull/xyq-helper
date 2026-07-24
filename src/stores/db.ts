import { defineStore } from 'pinia'
import type { UnknownQuestion } from '../types/question'
import type { QuestionRecord } from '../types/question'
import { listUnknownQuestions, saveUnknownQuestion } from '../composables/useLocalStorageDB'
import type { TrigramIndex } from '../utils/matcher'
import { demoQuestions } from '../utils/matcher'

export const useDBStore = defineStore('db', {
  state: () => ({
    ready: false,
    questionCount: 0,
    version: 'loading',
    searchMode: 'demo',
    questions: [] as QuestionRecord[],
    trigramIndex: {} as TrigramIndex,
    unknownQuestions: [] as UnknownQuestion[],
    error: '',
  }),
  actions: {
    async initializeQuestionIndex() {
      try {
        const [versionResponse, questionsResponse, indexResponse] = await Promise.all([
          fetch('/data/version.json'),
          fetch('/data/questions.json'),
          fetch('/data/trigram-index.json'),
        ])

        if (!versionResponse.ok || !questionsResponse.ok || !indexResponse.ok) {
          throw new Error('题库索引文件加载失败')
        }

        const version = await versionResponse.json() as {
          version?: string
          questionCount?: number
          searchMode?: string
        }
        const questions = await questionsResponse.json() as QuestionRecord[]
        const trigramIndex = await indexResponse.json() as TrigramIndex

        this.questions = questions.length > 0 ? questions : demoQuestions
        this.trigramIndex = questions.length > 0 ? trigramIndex : {}
        this.questionCount = this.questions.length
        this.version = version.version ?? 'json-local'
        this.searchMode = questions.length > 0 ? (version.searchMode ?? 'json-trigram') : 'demo'
        this.ready = true
      } catch (error) {
        this.questions = demoQuestions
        this.trigramIndex = {}
        this.questionCount = demoQuestions.length
        this.version = 'demo-local'
        this.searchMode = 'demo'
        this.error = error instanceof Error ? error.message : '题库加载失败，已使用演示题库'
        this.ready = true
      }
    },
    async refreshUnknownQuestions() {
      this.unknownQuestions = await listUnknownQuestions()
    },
    async addUnknownQuestion(question: UnknownQuestion) {
      await saveUnknownQuestion(question)
      await this.refreshUnknownQuestions()
    },
  },
})
