import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import type { UnknownQuestion } from '../types/question'
import type { QuestionRecord, UserQuestionRecord } from '../types/question'
import {
  deleteUserQuestion,
  listUnknownQuestions,
  listUserQuestions,
  putUserQuestion,
  replaceUserQuestions,
  saveUnknownQuestion,
} from '../composables/useLocalStorageDB'
import type { TrigramIndex } from '../utils/matcher'
import { buildTrigramIndex, demoQuestions } from '../utils/matcher'
import { normalizeQuestionText } from '../utils/normalizeText'

/** 生成兼容站点子目录部署的静态数据地址 */
function getDataUrl(fileName: string) {
  return new URL(`data/${fileName}`, document.baseURI).href
}

/** 将人工记录转换成运行时题目，并保留被覆盖基础题目的数字主键。 */
function materializeUserQuestion(record: UserQuestionRecord, id: number): QuestionRecord {
  const normalizedQuestion = normalizeQuestionText(record.question)
  return {
    id,
    question: record.question,
    normalizedQuestion,
    options: { ...record.options },
    normalizedOptions: ['A', 'B', 'C', 'D']
      .map((key) => `${key}${normalizeQuestionText(record.options[key as keyof typeof record.options])}`)
      .join(''),
    answer: record.answer,
    answerText: record.answerText,
    category: record.category,
    source: record.source,
  }
}

/** 把基础题库与人工覆盖层合成为实际参与检索的题库。 */
function mergeQuestionLayers(
  baseQuestions: QuestionRecord[],
  userQuestions: UserQuestionRecord[],
): QuestionRecord[] {
  const overrides = new Map(
    userQuestions.filter((item) => item.baseKey).map((item) => [item.baseKey, item]),
  )
  const merged = baseQuestions.map((question) => {
    const override = overrides.get(question.normalizedQuestion)
    return override ? materializeUserQuestion(override, question.id) : question
  })
  let customId = -1
  for (const record of userQuestions.filter((item) => !item.baseKey)) {
    merged.push(materializeUserQuestion(record, customId))
    customId -= 1
  }
  return merged
}

export const useDBStore = defineStore('db', {
  state: () => ({
    ready: false,
    questionCount: 0,
    version: 'loading',
    searchMode: 'demo',
    baseQuestions: [] as QuestionRecord[],
    questions: [] as QuestionRecord[],
    userQuestions: [] as UserQuestionRecord[],
    trigramIndex: {} as TrigramIndex,
    unknownQuestions: [] as UnknownQuestion[],
    error: '',
  }),
  actions: {
    async initializeQuestionIndex() {
      try {
        const [versionResponse, questionsResponse, indexResponse, userQuestions] = await Promise.all([
          fetch(getDataUrl('version.json')),
          fetch(getDataUrl('questions.json')),
          fetch(getDataUrl('trigram-index.json')),
          listUserQuestions(),
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

        const baseQuestions = questions.length > 0 ? questions : demoQuestions
        this.baseQuestions = markRaw(baseQuestions)
        this.userQuestions = userQuestions
        this.questions = markRaw(mergeQuestionLayers(this.baseQuestions, this.userQuestions))
        this.trigramIndex = markRaw(this.userQuestions.length > 0
          ? buildTrigramIndex(this.questions)
          : (questions.length > 0 ? trigramIndex : {}))
        this.questionCount = this.questions.length
        this.version = version.version ?? 'json-local'
        this.searchMode = questions.length > 0 ? (version.searchMode ?? 'json-trigram') : 'demo'
        this.ready = true
      } catch (error) {
        this.questions = markRaw(demoQuestions)
        this.baseQuestions = markRaw(demoQuestions)
        this.trigramIndex = markRaw({})
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
    /** 重新合并题库并重建索引，使人工修改立即参与识别。 */
    rebuildEffectiveQuestionBank() {
      const questions = mergeQuestionLayers(this.baseQuestions, this.userQuestions)
      this.questions = markRaw(questions)
      this.trigramIndex = markRaw(buildTrigramIndex(questions))
      this.questionCount = this.questions.length
    },
    /** 保存人工新增或修订题目。 */
    async saveUserQuestion(question: UserQuestionRecord) {
      const id = await putUserQuestion(question)
      this.userQuestions = await listUserQuestions()
      this.rebuildEffectiveQuestionBank()
      return id
    },
    /** 删除人工记录；基础题目的人工修订被删除后会恢复原始内容。 */
    async removeUserQuestion(id: number) {
      await deleteUserQuestion(id)
      this.userQuestions = await listUserQuestions()
      this.rebuildEffectiveQuestionBank()
    },
    /** 合并导入的人工题库，同一基础键或题干以导入版本覆盖。 */
    async importUserQuestions(records: UserQuestionRecord[]) {
      const merged = new Map<string, UserQuestionRecord>()
      for (const item of this.userQuestions) {
        merged.set(item.baseKey ?? normalizeQuestionText(item.question), item)
      }
      for (const item of records) {
        const key = item.baseKey ?? normalizeQuestionText(item.question)
        const existing = merged.get(key)
        merged.set(key, { ...item, id: existing?.id })
      }
      await replaceUserQuestions([...merged.values()])
      this.userQuestions = await listUserQuestions()
      this.rebuildEffectiveQuestionBank()
    },
  },
})
