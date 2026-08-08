<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { useDBStore } from '../stores/db'
import type {
  AnswerOptionKey,
  QuestionBankPackage,
  QuestionRecord,
  UserQuestionRecord,
} from '../types/question'
import { normalizeQuestionText } from '../utils/normalizeText'

const emit = defineEmits<{ close: [] }>()
const dbStore = useDBStore()
const keyword = ref('')
const searchKeyword = ref('')
const sourceFilter = ref<'all' | 'base' | 'manual'>('all')
const page = ref(1)
// 控制首屏 DOM 规模，避免表格自动布局形成长任务。
const pageSize = 20
const editing = ref(false)
const message = ref('')
const error = ref('')
const importInput = ref<HTMLInputElement | null>(null)
let searchTimer: ReturnType<typeof setTimeout> | null = null

interface ManagedQuestion {
  question: QuestionRecord
  userRecord?: UserQuestionRecord
  origin: 'base' | 'override' | 'custom'
  searchText: string
}

/** 为题库行预先生成检索文本，避免每次按键都重复归一化全部字段。 */
function createManagedQuestion(
  question: QuestionRecord,
  origin: ManagedQuestion['origin'],
  userRecord?: UserQuestionRecord,
): ManagedQuestion {
  return {
    question,
    userRecord,
    origin,
    searchText: normalizeQuestionText([
      question.normalizedQuestion,
      question.normalizedOptions,
      question.answerText,
      question.category,
    ].join(' ')),
  }
}

const form = reactive<UserQuestionRecord>({
  question: '',
  options: { A: '', B: '', C: '', D: '' },
  answer: 'A',
  answerText: '',
  category: '',
  source: 'manual',
  createdAt: '',
  updatedAt: '',
  revision: 1,
})

const managedQuestions = computed<ManagedQuestion[]>(() => {
  const effectiveById = new Map(dbStore.questions.map((question) => [question.id, question]))
  const userByBaseKey = new Map(
    dbStore.userQuestions.filter((item) => item.baseKey).map((item) => [item.baseKey, item]),
  )
  const baseRows = dbStore.baseQuestions.map((base) => {
    const userRecord = userByBaseKey.get(base.normalizedQuestion)
    const question = effectiveById.get(base.id) ?? base
    return createManagedQuestion(question, userRecord ? 'override' : 'base', userRecord)
  })
  const customRows = dbStore.userQuestions
    .filter((item) => !item.baseKey)
    .map((userRecord, index) => {
      const question = effectiveById.get(-(index + 1))
      return question ? createManagedQuestion(question, 'custom', userRecord) : null
    })
    .filter((item): item is ManagedQuestion => Boolean(item))
  return [...baseRows, ...customRows].sort((left, right) => {
    const leftTime = Date.parse(left.userRecord?.createdAt ?? '') || 0
    const rightTime = Date.parse(right.userRecord?.createdAt ?? '') || 0
    return rightTime - leftTime
  })
})

/** 格式化题目首次收录时间，基础题库没有本地收录时间。 */
function formatCollectedAt(value?: string): string {
  if (!value) return '—'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp)
}

const filteredQuestions = computed(() => {
  const query = normalizeQuestionText(searchKeyword.value)
  return managedQuestions.value.filter((item) => {
    const sourceMatches = sourceFilter.value === 'all'
      || (sourceFilter.value === 'base' && item.origin === 'base')
      || (sourceFilter.value === 'manual' && item.origin !== 'base')
    if (!sourceMatches) return false
    if (!query) return true
    return item.searchText.includes(query)
  })
})

const pageCount = computed(() => Math.max(1, Math.ceil(filteredQuestions.value.length / pageSize)))
const pagedQuestions = computed(() => {
  const currentPage = Math.min(page.value, pageCount.value)
  return filteredQuestions.value.slice((currentPage - 1) * pageSize, currentPage * pageSize)
})

/** 清空提示，避免上一次操作结果干扰当前操作。 */
function clearFeedback(): void {
  message.value = ''
  error.value = ''
}

/** 打开新增题目表单。 */
function createQuestion(): void {
  clearFeedback()
  Object.assign(form, {
    id: undefined,
    baseKey: undefined,
    question: '',
    options: { A: '', B: '', C: '', D: '' },
    answer: 'A' as AnswerOptionKey,
    answerText: '',
    category: '',
    source: 'manual' as const,
    createdAt: '',
    updatedAt: '',
    revision: 1,
  })
  editing.value = true
}

/** 打开已有题目表单，基础题目保存后自动形成覆盖记录。 */
function editQuestion(item: ManagedQuestion): void {
  clearFeedback()
  const now = new Date().toISOString()
  const source = item.userRecord
  Object.assign(form, {
    id: source?.id,
    baseKey: source?.baseKey ?? (item.origin === 'base' ? item.question.normalizedQuestion : undefined),
    question: item.question.question,
    options: { ...item.question.options },
    answer: item.question.answer ?? 'A',
    answerText: item.question.answerText ?? '',
    category: item.question.category,
    source: 'manual' as const,
    createdAt: source?.createdAt ?? now,
    updatedAt: source?.updatedAt ?? now,
    revision: source?.revision ?? 0,
  })
  editing.value = true
}

/** 保存人工题目，并立即刷新实际检索题库。 */
async function saveQuestion(): Promise<void> {
  clearFeedback()
  const question = form.question.trim()
  if (!question) {
    error.value = '题干不能为空'
    return
  }
  const now = new Date().toISOString()
  const answer = form.answer ?? 'A'
  const record: UserQuestionRecord = {
    ...(form.id ? { id: form.id } : {}),
    ...(form.baseKey ? { baseKey: form.baseKey } : {}),
    question,
    options: {
      A: form.options.A.trim(),
      B: form.options.B.trim(),
      C: form.options.C.trim(),
      D: form.options.D.trim(),
    },
    answer,
    answerText: form.answerText?.trim() || form.options[answer].trim(),
    category: form.category.trim(),
    source: 'manual',
    createdAt: form.createdAt || now,
    updatedAt: now,
    revision: form.revision + 1,
  }
  await dbStore.saveUserQuestion(record)
  editing.value = false
  message.value = form.baseKey ? '题目修订已保存并立即生效' : '新题目已保存并立即生效'
}

/** 删除人工新增题，或移除基础题目的覆盖层以恢复原始版本。 */
async function removeUserRecord(item: ManagedQuestion): Promise<void> {
  if (!item.userRecord?.id) return
  clearFeedback()
  await dbStore.removeUserQuestion(item.userRecord.id)
  message.value = item.origin === 'override' ? '已恢复基础题库版本' : '人工题目已删除'
}

/** 下载指定对象为 UTF-8 JSON 文件。 */
function downloadJson(fileName: string, payload: unknown): void {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

/** 构造可分享、可校验版本的题库包。 */
function createPackage(mode: 'full' | 'patch'): QuestionBankPackage {
  const exportedAt = new Date().toISOString()
  return {
    format: 'xyq-question-bank',
    schemaVersion: 1,
    mode,
    name: '梦幻西游个人题库',
    version: exportedAt.slice(0, 10),
    exportedAt,
    ...(mode === 'full' ? { questions: dbStore.questions } : {}),
    changes: dbStore.userQuestions,
  }
}

/** 导出完整有效题库，同时携带人工修订层供其他客户端精准合并。 */
function exportFullBank(): void {
  const date = new Date().toISOString().slice(0, 10)
  downloadJson(`xyq-question-bank-full-${date}.json`, createPackage('full'))
  message.value = `已导出 ${dbStore.questions.length} 道有效题目`
}

/** 仅导出人工新增和修订记录，适合分享小体积更新包。 */
function exportPatch(): void {
  const date = new Date().toISOString().slice(0, 10)
  downloadJson(`xyq-question-bank-patch-${date}.json`, createPackage('patch'))
  message.value = `已导出 ${dbStore.userQuestions.length} 条人工更新`
}

/** 唤起系统文件选择器导入题库包。 */
function chooseImportFile(): void {
  clearFeedback()
  importInput.value?.click()
}

/** 校验并合并导入包中的人工修订数据。 */
async function importQuestionBank(event: Event): Promise<void> {
  clearFeedback()
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const payload = JSON.parse(await file.text()) as Partial<QuestionBankPackage>
    if (payload.format !== 'xyq-question-bank' || payload.schemaVersion !== 1) {
      throw new Error('不是受支持的 xyq_helper 题库文件')
    }
    if (!Array.isArray(payload.changes)) throw new Error('题库文件缺少人工修订数据')
    await dbStore.importUserQuestions(payload.changes)
    message.value = `已导入并合并 ${payload.changes.length} 条人工更新`
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '题库导入失败'
  }
}

/** 切换筛选条件时回到第一页。 */
function resetPage(): void {
  page.value = 1
}

/** 合并连续输入，只在用户短暂停顿后执行一次全题库筛选。 */
function scheduleSearch(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    searchKeyword.value = keyword.value
    page.value = 1
    searchTimer = null
  }, 120)
}

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <section class="question-bank-page">
    <div class="question-bank-heading">
      <div>
        <button type="button" class="back-button" @click="emit('close')">← 返回识别</button>
        <h2>题库维护</h2>
        <p>基础题库保持只读；你的修改保存在人工覆盖层，并优先参与识别。</p>
      </div>
      <div class="question-bank-stats">
        <span><strong>{{ dbStore.questions.length }}</strong> 有效题目</span>
        <span><strong>{{ dbStore.userQuestions.filter((item) => item.baseKey).length }}</strong> 本地修订</span>
        <span><strong>{{ dbStore.userQuestions.filter((item) => !item.baseKey).length }}</strong> 新增收录</span>
      </div>
    </div>

    <div class="question-bank-toolbar panel">
      <input
        v-model="keyword"
        type="search"
        placeholder="搜索题干、选项、答案或分类"
        @input="scheduleSearch"
      />
      <select v-model="sourceFilter" @change="resetPage">
        <option value="all">全部来源</option>
        <option value="base">仅基础题库</option>
        <option value="manual">仅本地收录</option>
      </select>
      <button type="button" class="primary-action" @click="createQuestion">新增题目</button>
      <button type="button" @click="exportFullBank">导出完整题库</button>
      <button type="button" @click="exportPatch">导出更新包</button>
      <button type="button" @click="chooseImportFile">导入题库</button>
      <input ref="importInput" class="hidden-file-input" type="file" accept="application/json,.json" @change="importQuestionBank" />
    </div>

    <p v-if="message" class="success-text question-bank-feedback">{{ message }}</p>
    <p v-if="error" class="error-text question-bank-feedback">{{ error }}</p>

    <div class="question-table-wrap panel">
      <table class="question-table">
        <thead>
          <tr><th>题干</th><th>答案</th><th>分类</th><th>来源</th><th>收录时间 ↓</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in pagedQuestions" :key="`${item.origin}-${item.question.id}`">
            <td>
              <strong>{{ item.question.question }}</strong>
              <small>{{ Object.entries(item.question.options).map(([key, value]) => `${key}. ${value}`).join('　') }}</small>
            </td>
            <td><b>{{ item.question.answer || '—' }}</b> {{ item.question.answerText }}</td>
            <td>{{ item.question.category || '未分类' }}</td>
            <td>
              <span class="source-badge" :class="item.origin">
                {{ item.question.source === '175dt' ? '175DT' : item.origin === 'base' ? '基础' : item.origin === 'override' ? '已修订' : '新增' }}
              </span>
            </td>
            <td class="question-collected-at">{{ formatCollectedAt(item.userRecord?.createdAt) }}</td>
            <td class="question-actions">
              <button type="button" @click="editQuestion(item)">编辑</button>
              <button v-if="item.userRecord" type="button" class="danger-action" @click="removeUserRecord(item)">
                {{ item.origin === 'override' ? '恢复原版' : '删除' }}
              </button>
            </td>
          </tr>
          <tr v-if="pagedQuestions.length === 0"><td colspan="6" class="muted">没有匹配题目。</td></tr>
        </tbody>
      </table>
      <footer class="question-pagination">
        <span>共 {{ filteredQuestions.length }} 条</span>
        <button type="button" :disabled="page <= 1" @click="page -= 1">上一页</button>
        <span>{{ Math.min(page, pageCount) }} / {{ pageCount }}</span>
        <button type="button" :disabled="page >= pageCount" @click="page += 1">下一页</button>
      </footer>
    </div>

    <div v-if="editing" class="editor-backdrop" @click.self="editing = false">
      <form class="question-editor panel" @submit.prevent="saveQuestion">
        <div class="question-editor-title">
          <h2>{{ form.id || form.baseKey ? '编辑题目' : '新增题目' }}</h2>
          <button type="button" @click="editing = false">关闭</button>
        </div>
        <label>题干<textarea v-model="form.question" rows="3" required /></label>
        <div class="option-editor-grid">
          <label v-for="key in (['A', 'B', 'C', 'D'] as AnswerOptionKey[])" :key="key">
            选项 {{ key }}<input v-model="form.options[key]" type="text" />
          </label>
        </div>
        <div class="question-editor-grid">
          <label>正确选项<select v-model="form.answer"><option v-for="key in ['A', 'B', 'C', 'D']" :key="key">{{ key }}</option></select></label>
          <label>答案文本<input v-model="form.answerText" type="text" placeholder="留空则使用正确选项文本" /></label>
          <label>分类<input v-model="form.category" type="text" /></label>
        </div>
        <div class="question-editor-actions">
          <button type="button" @click="editing = false">取消</button>
          <button type="submit" class="primary-action">保存并生效</button>
        </div>
      </form>
    </div>
  </section>
</template>
