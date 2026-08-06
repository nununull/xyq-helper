# Frontend Realtime Question Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有单次“截图 OCR + 本地题库匹配”改造成纯前端自动连续识别，并在用户选择的活动分类内执行“成功缓存优先、完整题干主查询、一次关键词降级”的实时查询链路。

**Architecture:** 保留现有捕获和 OCR composable，新增相互独立的查询文本、远程客户端、候选排序、IndexedDB 缓存、稳定器和调度器模块。Pinia 只保存可展示状态，异步循环和取消控制集中在 `useRecognitionController`，避免把网络、OCR 和 UI 职责堆进 `Dashboard.vue`。

**Tech Stack:** Vue 3、TypeScript 5、Pinia、Vite 5、Tesseract.js、idb、Vitest、fake-indexeddb。

## Global Constraints

- 交付形态为纯前端静态页面，不新增项目后端或公共代理。
- 用户必须手动选择活动分类，远程请求只查询当前分类。
- 每道题最多执行一次完整题干查询和一次关键词降级查询。
- 成功结果写入 IndexedDB；空结果和错误只做内存冷却。
- 同时最多运行一个 OCR 任务和一个远程请求；换题、暂停、停止共享和切换分类时取消旧任务。
- 所有新增或修改的方法必须有说明职责的中文注释。
- 不为兼容单元测试增加生产环境无意义分支或重复接口。
- 不删除、不重构现有爬虫与题库构建脚本。

---

## File Map

### Create

- `src/types/remoteQuestion.ts`：远程查询、缓存、识别阶段和候选结果的共享类型。
- `src/data/activityCategories.ts`：可选活动分类的静态清单。
- `src/features/remote-query/queryText.ts`：远程查询清洗、指纹和降级关键词选择。
- `src/features/remote-query/remoteQuestionClient.ts`：175DT 请求、取消、超时和错误分类。
- `src/features/remote-query/remoteCandidateMatcher.ts`：候选题排序与答案选项推导。
- `src/features/remote-query/remoteQuestionCache.ts`：IndexedDB 成功结果仓储。
- `src/features/recognition/questionStabilizer.ts`：连续 OCR 结果稳定性判断。
- `src/features/recognition/useRecognitionController.ts`：连续识别串行循环和任务取消。
- `src/stores/recognition.ts`：识别阶段、提示、来源和耗时状态。
- `src/features/remote-query/*.test.ts`：查询文本、客户端、匹配和缓存测试。
- `src/features/recognition/*.test.ts`：稳定器和调度规则测试。

### Modify

- `package.json`、`package-lock.json`：加入 Vitest、fake-indexeddb 和测试脚本。
- `vite.config.ts`：加入 Vitest 配置。
- `src/types/config.ts`：加入当前活动分类和远程查询参数。
- `src/types/match.ts`：允许仅展示答案文本，并记录结果来源和耗时。
- `src/composables/useLocalStorageDB.ts`：数据库升级到 v2 并创建远程成功缓存表。
- `src/stores/config.ts`：提供持久化选择活动分类的方法。
- `src/stores/matcher.ts`：清理旧错误并接受远程匹配结果。
- `src/components/Dashboard.vue`：接入活动分类选择、自动识别和手动重试。
- `src/components/AnswerOverlay.vue`：支持无法推导选项字母时展示答案文本。
- `src/components/SettingsPanel.vue`：加入缓存清理入口。
- `src/composables/useScreenCapture.ts`：暴露共享流结束事件，供识别控制器及时暂停。
- `src/assets/styles/main.css`：增加分类选中、阶段提示和结果元信息样式。

---

### Task 1: Test Harness and Query Text Rules

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vite.config.ts`
- Create: `src/features/remote-query/queryText.ts`
- Test: `src/features/remote-query/queryText.test.ts`

**Interfaces:**
- Produces: `cleanRemoteQueryText(text: string): string`
- Produces: `createQuestionFingerprint(text: string): string`
- Produces: `selectFallbackKeyword(text: string): string | null`

- [ ] **Step 1: Install the test dependencies and add scripts**

Run:

```powershell
npm install --save-dev vitest@^2.1.9 fake-indexeddb@^6.0.1
```

Add these scripts to `package.json`:

```json
"test": "vitest",
"test:run": "vitest run"
```

Update `vite.config.ts` to:

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    clearMocks: true,
  },
})
```

- [ ] **Step 2: Write failing query-text tests**

Create `src/features/remote-query/queryText.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  cleanRemoteQueryText,
  createQuestionFingerprint,
  selectFallbackKeyword,
} from './queryText'

describe('远程查询文本', () => {
  it('清理换行、选项编号和 OCR 符号噪声，但保留题意', () => {
    expect(cleanRemoteQueryText(' 唐代诗人中，\n被称为“诗鬼”的是谁？ A.李白 '))
      .toBe('唐代诗人中，被称为“诗鬼”的是谁？')
  })

  it('相同标准化题干生成相同指纹', () => {
    expect(createQuestionFingerprint('谁被称为诗鬼？'))
      .toBe(createQuestionFingerprint('谁 被称为“诗鬼”'))
  })

  it('优先使用引号中的专有内容作为降级关键词', () => {
    expect(selectFallbackKeyword('唐代诗人中，被称为“诗鬼”的是谁？')).toBe('诗鬼')
  })

  it('不会选择通用问句词', () => {
    expect(selectFallbackKeyword('以下哪个说法是正确的？')).toBeNull()
  })
})
```

- [ ] **Step 3: Run the focused test and verify failure**

Run:

```powershell
npm run test:run -- src/features/remote-query/queryText.test.ts
```

Expected: FAIL because `queryText.ts` does not exist.

- [ ] **Step 4: Implement the query text rules**

Create `src/features/remote-query/queryText.ts`:

```ts
import { normalizeQuestionText } from '../../utils/normalizeText'

const genericWords = new Set(['以下', '哪个', '什么', '正确', '错误', '属于', '说法', '的是'])

/** 清理 OCR 题干，使其适合作为远程接口的主查询文本。 */
export function cleanRemoteQueryText(text: string): string {
  return text
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+[ABCD][.。:：、]\s*.*$/i, '')
    .replace(/[|丨¦]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 为分类内的标准化题干生成稳定且紧凑的本地缓存指纹。 */
export function createQuestionFingerprint(text: string): string {
  const normalized = normalizeQuestionText(text)
  let hash = 2166136261
  for (const char of normalized) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

/** 从题干中选择唯一的高信息量降级关键词。 */
export function selectFallbackKeyword(text: string): string | null {
  const quoted = text.match(/[“”"《》]([^“”"《》]{2,8})[“”"《》]/)?.[1]
  if (quoted && !genericWords.has(quoted)) {
    return quoted
  }

  const candidates = normalizeQuestionText(text)
    .split(/(?:以下|哪个|什么|正确|错误|属于|说法|的是|中|被称为)/)
    .map((part) => part.replace(/[^\u3400-\u9fff0-9]/g, ''))
    .filter((part) => part.length >= 2 && part.length <= 4 && !genericWords.has(part))

  return candidates.sort((left, right) => right.length - left.length)[0] ?? null
}
```

- [ ] **Step 5: Run tests and build**

Run:

```powershell
npm run test:run -- src/features/remote-query/queryText.test.ts
npm run build
```

Expected: 4 tests PASS; TypeScript and Vite build succeed.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json vite.config.ts src/features/remote-query/queryText.ts src/features/remote-query/queryText.test.ts
git commit -m "test: add remote query text rules"
```

---

### Task 2: Remote Query Types and 175DT Client

**Files:**
- Create: `src/types/remoteQuestion.ts`
- Create: `src/features/remote-query/remoteQuestionClient.ts`
- Test: `src/features/remote-query/remoteQuestionClient.test.ts`

**Interfaces:**
- Consumes: `cleanRemoteQueryText(text: string): string`
- Produces: `queryRemoteQuestions(categoryId: string, queryText: string, options?: RemoteQueryOptions): Promise<RemoteQueryResult>`
- Produces: discriminated union `RemoteQueryResult`

- [ ] **Step 1: Define shared remote-query types**

Create `src/types/remoteQuestion.ts`:

```ts
import type { AnswerOptionKey } from './question'

export interface ActivityCategory {
  id: string
  name: string
}

export interface RemoteQuestionCandidate {
  question: string
  answerText: string
  source: '175dt'
}

export type RemoteQueryFailureKind =
  | 'corsBlocked'
  | 'timeout'
  | 'rateLimited'
  | 'remoteError'
  | 'malformedResponse'

export type RemoteQueryResult =
  | { kind: 'success'; candidates: RemoteQuestionCandidate[] }
  | { kind: 'empty'; candidates: [] }
  | { kind: RemoteQueryFailureKind; message: string; status?: number }

export interface RemoteQueryOptions {
  signal?: AbortSignal
  timeoutMs?: number
  fetcher?: typeof fetch
}

export interface RankedRemoteCandidate extends RemoteQuestionCandidate {
  answer: AnswerOptionKey | null
  questionScore: number
  optionScore: number
  confidence: number
}

export interface RemoteQuestionCache {
  id: string
  categoryId: string
  questionFingerprint: string
  recognizedQuestion: string
  matchedQuestion: string
  answerText: string
  source: string
  matchConfidence: number
  createdAt: number
  lastUsedAt: number
  hitCount: number
}

export type RecognitionPhase =
  | 'idle'
  | 'capturing'
  | 'recognizing'
  | 'stabilizing'
  | 'cacheLookup'
  | 'primaryQuery'
  | 'fallbackQuery'
  | 'matching'
  | 'showingAnswer'
  | 'waitingRetry'
  | 'paused'
```

- [ ] **Step 2: Write failing client tests**

Create `src/features/remote-query/remoteQuestionClient.test.ts` with mocked fetch cases for: encoded category/query parameters, successful HTML cleaning, empty hits, 429, malformed response, `TypeError`, timeout and external cancellation. Use this exact success assertion:

```ts
import { describe, expect, it, vi } from 'vitest'
import { queryRemoteQuestions } from './remoteQuestionClient'

describe('175DT 远程客户端', () => {
  it('编码参数并解析候选题', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain('id=44')
      expect(String(input)).toContain('kw=%E8%AF%97%E9%AC%BC')
      return new Response(JSON.stringify({ status: 200, hits: [{ q: '<b>诗鬼是谁</b>', a: '李贺' }] }), { status: 200 })
    })

    await expect(queryRemoteQuestions('44', '诗鬼', { fetcher })).resolves.toEqual({
      kind: 'success',
      candidates: [{ question: '诗鬼是谁', answerText: '李贺', source: '175dt' }],
    })
  })

  it.each([403, 429])('把 %s 识别为限流', async (status) => {
    const fetcher = vi.fn(async () => new Response('', { status }))
    const result = await queryRemoteQuestions('44', '诗鬼', { fetcher })
    expect(result.kind).toBe('rateLimited')
  })

  it('把网络 TypeError 归类为可能的跨域错误', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    const result = await queryRemoteQuestions('44', '诗鬼', { fetcher })
    expect(result.kind).toBe('corsBlocked')
  })
})
```

Add focused tests in the same file for `empty`, `malformedResponse`, timeout and external `AbortController.abort()`.

- [ ] **Step 3: Run the client test and verify failure**

Run:

```powershell
npm run test:run -- src/features/remote-query/remoteQuestionClient.test.ts
```

Expected: FAIL because the client module does not exist.

- [ ] **Step 4: Implement the remote client**

Create `src/features/remote-query/remoteQuestionClient.ts`. The implementation must:

```ts
import type {
  RemoteQueryOptions,
  RemoteQueryResult,
  RemoteQuestionCandidate,
} from '../../types/remoteQuestion'

const endpoint = 'https://s.175dt.com/'

/** 调用 175DT 搜索接口，并把网络与协议错误转换为结构化结果。 */
export async function queryRemoteQuestions(
  categoryId: string,
  queryText: string,
  options: RemoteQueryOptions = {},
): Promise<RemoteQueryResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort('timeout'), options.timeoutMs ?? 1_500)
  const cancel = () => controller.abort('external')
  options.signal?.addEventListener('abort', cancel, { once: true })

  const url = new URL(endpoint)
  url.search = new URLSearchParams({ id: categoryId, kw: queryText, c: '10000' }).toString()

  try {
    const response = await (options.fetcher ?? fetch)(url, { signal: controller.signal })
    if (response.status === 403 || response.status === 429) {
      return { kind: 'rateLimited', message: '接口暂时拒绝请求', status: response.status }
    }
    if (!response.ok) {
      return { kind: 'remoteError', message: `远程接口返回 ${response.status}`, status: response.status }
    }

    const payload: unknown = await response.json()
    if (!isRemotePayload(payload)) {
      return { kind: 'malformedResponse', message: '远程接口响应格式异常' }
    }

    const candidates = payload.hits
      .map((hit): RemoteQuestionCandidate => ({
        question: stripRemoteHtml(hit.q),
        answerText: stripRemoteHtml(hit.a),
        source: '175dt',
      }))
      .filter((item) => item.question && item.answerText)

    return candidates.length > 0 ? { kind: 'success', candidates } : { kind: 'empty', candidates: [] }
  } catch (error) {
    if (controller.signal.aborted) {
      return { kind: 'timeout', message: options.signal?.aborted ? '请求已取消' : '远程题库响应超时' }
    }
    if (error instanceof TypeError) {
      return { kind: 'corsBlocked', message: '可能是 CORS 或网络错误' }
    }
    return { kind: 'remoteError', message: error instanceof Error ? error.message : '远程请求失败' }
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', cancel)
  }
}

interface RemotePayload {
  status: number
  hits: Array<{ q: string; a: string }>
}

/** 校验第三方接口的最小响应契约。 */
function isRemotePayload(payload: unknown): payload is RemotePayload {
  if (!payload || typeof payload !== 'object') return false
  const candidate = payload as Partial<RemotePayload>
  return typeof candidate.status === 'number'
    && Array.isArray(candidate.hits)
    && candidate.hits.every((hit) => typeof hit?.q === 'string' && typeof hit?.a === 'string')
}

/** 移除接口题干中的高亮标签和常见 HTML 实体。 */
function stripRemoteHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}
```

- [ ] **Step 5: Run client tests and build**

Run:

```powershell
npm run test:run -- src/features/remote-query/remoteQuestionClient.test.ts
npm run build
```

Expected: all client tests PASS; build succeeds.

- [ ] **Step 6: Commit**

```powershell
git add src/types/remoteQuestion.ts src/features/remote-query/remoteQuestionClient.ts src/features/remote-query/remoteQuestionClient.test.ts
git commit -m "feat: add remote question client"
```

---

### Task 3: Remote Candidate Ranking and Answer Resolution

**Files:**
- Modify: `src/types/match.ts`
- Create: `src/features/remote-query/remoteCandidateMatcher.ts`
- Test: `src/features/remote-query/remoteCandidateMatcher.test.ts`

**Interfaces:**
- Consumes: `ParsedQuestion`, `RemoteQuestionCandidate[]`, OCR confidence in `[0, 1]`
- Produces: `rankRemoteCandidates(parsed, candidates, ocrConfidence): RemoteMatchDecision`
- Produces: `inferRemoteAnswer(answerText, options): { answer; score }`

- [ ] **Step 1: Write failing ranking tests**

Cover these exact behaviors:

```ts
import { describe, expect, it } from 'vitest'
import { rankRemoteCandidates } from './remoteCandidateMatcher'

const parsed = {
  questionText: '被称为诗鬼的唐代诗人是谁？',
  normalizedQuestion: '被称为诗鬼的唐代诗人是谁',
  options: { A: '李白', B: '杜甫', C: '李贺', D: '白居易' },
  normalizedOptions: 'A李白B杜甫C李贺D白居易',
  rawText: '',
}

describe('远程候选排序', () => {
  it('选择题干最接近且答案能对应选项的候选题', () => {
    const decision = rankRemoteCandidates(parsed, [
      { question: '被称为诗圣的诗人是谁？', answerText: '杜甫', source: '175dt' },
      { question: '被称为诗鬼的唐代诗人是谁？', answerText: '李贺', source: '175dt' },
    ], 0.9)
    expect(decision.best?.answer).toBe('C')
    expect(decision.kind).toBe('confident')
  })

  it('答案无法对应选项时保留答案文本但不猜字母', () => {
    const decision = rankRemoteCandidates(parsed, [
      { question: parsed.questionText, answerText: '韩愈', source: '175dt' },
    ], 0.9)
    expect(decision.best?.answer).toBeNull()
    expect(decision.best?.answerText).toBe('韩愈')
  })

  it('前两名分差小于 0.05 时标记歧义', () => {
    const decision = rankRemoteCandidates(parsed, [
      { question: parsed.questionText, answerText: '李贺', source: '175dt' },
      { question: parsed.questionText, answerText: '杜甫', source: '175dt' },
    ], 0.9)
    expect(decision.kind).toBe('ambiguous')
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run `npm run test:run -- src/features/remote-query/remoteCandidateMatcher.test.ts`.

Expected: FAIL because the matcher module does not exist.

- [ ] **Step 3: Implement ranking**

Create `src/features/remote-query/remoteCandidateMatcher.ts` with:

```ts
import type { ParsedQuestion } from '../../types/question'
import type { RankedRemoteCandidate, RemoteQuestionCandidate } from '../../types/remoteQuestion'
import { diceSimilarity } from '../../utils/normalizeText'

export interface RemoteMatchDecision {
  kind: 'confident' | 'lowConfidence' | 'ambiguous' | 'rejected'
  best: RankedRemoteCandidate | null
  candidates: RankedRemoteCandidate[]
}

/** 对远程候选题排序，并根据阈值判断结果是否可直接展示。 */
export function rankRemoteCandidates(
  parsed: ParsedQuestion,
  candidates: RemoteQuestionCandidate[],
  ocrConfidence: number,
): RemoteMatchDecision {
  const ranked = candidates
    .map((candidate) => {
      const inferred = inferRemoteAnswer(candidate.answerText, parsed.options)
      const questionScore = diceSimilarity(parsed.questionText, candidate.question)
      const confidence = questionScore * 0.7 + inferred.score * 0.2 + ocrConfidence * 0.1
      return { ...candidate, answer: inferred.answer, questionScore, optionScore: inferred.score, confidence }
    })
    .sort((left, right) => right.confidence - left.confidence)

  const best = ranked[0] ?? null
  if (!best || best.confidence < 0.68) return { kind: 'rejected', best, candidates: ranked }
  if (ranked[1] && best.confidence - ranked[1].confidence < 0.05) {
    return { kind: 'ambiguous', best, candidates: ranked }
  }
  return { kind: best.confidence >= 0.82 ? 'confident' : 'lowConfidence', best, candidates: ranked }
}

/** 将答案文本与本次 OCR 选项比较，无法可靠对应时返回空字母。 */
export function inferRemoteAnswer(
  answerText: string,
  options: ParsedQuestion['options'],
): { answer: RankedRemoteCandidate['answer']; score: number } {
  let answer: RankedRemoteCandidate['answer'] = null
  let score = 0
  for (const [key, optionText] of Object.entries(options)) {
    const current = diceSimilarity(answerText, optionText ?? '')
    if (current > score) {
      answer = key as RankedRemoteCandidate['answer']
      score = current
    }
  }
  return score >= 0.5 ? { answer, score } : { answer: null, score }
}
```

Extend `MatchResult` in `src/types/match.ts` without removing existing fields:

```ts
export interface MatchResult {
  questionId: number | string
  answer: AnswerOptionKey | null
  answerText?: string
  confidence: number
  matchedQuestion: string
  source: string
  resultSource?: 'local' | 'cache' | 'remote'
  durationMs?: number
  warning?: string
  category?: string
  candidates: MatchCandidate[]
}
```

Update `src/utils/matcher.ts` so the existing local result explicitly returns `resultSource: 'local'` and remains type-correct.

- [ ] **Step 4: Run ranking tests and build**

Run:

```powershell
npm run test:run -- src/features/remote-query/remoteCandidateMatcher.test.ts
npm run build
```

Expected: ranking tests PASS; existing matcher remains type-correct.

- [ ] **Step 5: Commit**

```powershell
git add src/types/match.ts src/utils/matcher.ts src/features/remote-query/remoteCandidateMatcher.ts src/features/remote-query/remoteCandidateMatcher.test.ts
git commit -m "feat: rank remote question candidates"
```

---

### Task 4: IndexedDB Remote Success Cache

**Files:**
- Modify: `src/composables/useLocalStorageDB.ts`
- Create: `src/features/remote-query/remoteQuestionCache.ts`
- Test: `src/features/remote-query/remoteQuestionCache.test.ts`

**Interfaces:**
- Consumes: `RemoteQuestionCache`
- Produces: `createRemoteQuestionCacheRepository(db): RemoteQuestionCacheRepository`
- Produces: `getRemoteQuestionCache`, `putRemoteQuestionCache`, `clearRemoteQuestionCacheByCategory`, `clearAllRemoteQuestionCache`

- [ ] **Step 1: Write failing repository tests**

Use `fake-indexeddb/auto` and a real `idb` database created per test. Verify put/get increments are performed by caller data, category clearing leaves other categories, and full clearing empties the store. The first test must assert:

```ts
import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { afterEach, describe, expect, it } from 'vitest'
import { createRemoteQuestionCacheRepository } from './remoteQuestionCache'

const databaseNames: string[] = []

afterEach(async () => {
  for (const name of databaseNames.splice(0)) indexedDB.deleteDatabase(name)
})

describe('远程题目缓存', () => {
  it('按分类和题目指纹保存并读取成功结果', async () => {
    const name = `xyq-helper-test-${crypto.randomUUID()}`
    databaseNames.push(name)
    const db = await openDB(name, 1, { upgrade(database) { database.createObjectStore('remote_question_cache', { keyPath: 'id' }) } })
    const repository = createRemoteQuestionCacheRepository(db)
    await repository.put({
      id: '44:abc', categoryId: '44', questionFingerprint: 'abc',
      recognizedQuestion: '诗鬼是谁', matchedQuestion: '诗鬼是谁', answerText: '李贺',
      source: '175dt', matchConfidence: 0.95, createdAt: 1, lastUsedAt: 1, hitCount: 1,
    })
    expect((await repository.get('44', 'abc'))?.answerText).toBe('李贺')
    db.close()
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run `npm run test:run -- src/features/remote-query/remoteQuestionCache.test.ts`.

Expected: FAIL because the repository module does not exist.

- [ ] **Step 3: Implement the repository and database upgrade**

Create `src/features/remote-query/remoteQuestionCache.ts`:

```ts
import type { IDBPDatabase } from 'idb'
import type { RemoteQuestionCache } from '../../types/remoteQuestion'

export interface RemoteQuestionCacheRepository {
  get(categoryId: string, fingerprint: string): Promise<RemoteQuestionCache | undefined>
  put(record: RemoteQuestionCache): Promise<void>
  clearCategory(categoryId: string): Promise<void>
  clearAll(): Promise<void>
}

/** 基于给定数据库创建远程成功结果仓储，便于生产代码和独立数据库复用。 */
export function createRemoteQuestionCacheRepository(db: IDBPDatabase): RemoteQuestionCacheRepository {
  return {
    async get(categoryId, fingerprint) {
      return await db.get('remote_question_cache', `${categoryId}:${fingerprint}`) as RemoteQuestionCache | undefined
    },
    async put(record) {
      await db.put('remote_question_cache', record)
    },
    async clearCategory(categoryId) {
      const transaction = db.transaction('remote_question_cache', 'readwrite')
      let cursor = await transaction.store.openCursor()
      while (cursor) {
        const record = cursor.value as RemoteQuestionCache
        if (record.categoryId === categoryId) await cursor.delete()
        cursor = await cursor.continue()
      }
      await transaction.done
    },
    async clearAll() {
      await db.clear('remote_question_cache')
    },
  }
}
```

Upgrade `useLocalStorageDB.ts` from database version `1` to `2`. In `upgrade`, create `remote_question_cache` only when it does not exist. Export wrapper methods that await the shared database and delegate to the repository. Include this store in `clearAllLocalData()`.

- [ ] **Step 4: Run cache tests and build**

Run:

```powershell
npm run test:run -- src/features/remote-query/remoteQuestionCache.test.ts
npm run build
```

Expected: cache tests PASS; database upgrade compiles.

- [ ] **Step 5: Commit**

```powershell
git add src/composables/useLocalStorageDB.ts src/features/remote-query/remoteQuestionCache.ts src/features/remote-query/remoteQuestionCache.test.ts
git commit -m "feat: cache successful remote questions"
```

---

### Task 5: Question Stabilizer and Recognition State

**Files:**
- Create: `src/features/recognition/questionStabilizer.ts`
- Test: `src/features/recognition/questionStabilizer.test.ts`
- Create: `src/stores/recognition.ts`

**Interfaces:**
- Produces: `createQuestionStabilizer(requiredSimilarity = 0.9)`
- Produces: `{ push(question): ParsedQuestion | null; reset(): void }`
- Produces: Pinia actions `setPhase`, `setMessage`, `setRunning`, `setLastCompletedFingerprint`, `reset`

- [ ] **Step 1: Write failing stabilizer tests**

Test that the first OCR result is held, a second result at or above `0.9` returns the current parsed question, an unrelated result restarts the pair, and `reset()` removes history.

```ts
import { describe, expect, it } from 'vitest'
import { createQuestionStabilizer } from './questionStabilizer'

const parsed = (text: string) => ({
  questionText: text, normalizedQuestion: text, options: {}, normalizedOptions: '', rawText: text,
})

describe('题目稳定器', () => {
  it('连续两个相似结果才输出稳定题目', () => {
    const stabilizer = createQuestionStabilizer(0.9)
    expect(stabilizer.push(parsed('被称为诗鬼的诗人是谁'))).toBeNull()
    expect(stabilizer.push(parsed('被称为诗鬼的诗人是谁'))?.questionText).toBe('被称为诗鬼的诗人是谁')
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run `npm run test:run -- src/features/recognition/questionStabilizer.test.ts`.

Expected: FAIL because the stabilizer module does not exist.

- [ ] **Step 3: Implement the stabilizer**

```ts
import type { ParsedQuestion } from '../../types/question'
import { diceSimilarity } from '../../utils/normalizeText'

/** 创建连续 OCR 题目稳定器，只有相邻结果足够相似时才放行。 */
export function createQuestionStabilizer(requiredSimilarity = 0.9) {
  let previous: ParsedQuestion | null = null
  return {
    /** 记录一次 OCR 结果，并在连续稳定时返回当前题目。 */
    push(current: ParsedQuestion): ParsedQuestion | null {
      const stable = previous
        && diceSimilarity(previous.normalizedQuestion, current.normalizedQuestion) >= requiredSimilarity
      previous = current
      return stable ? current : null
    },
    /** 清除上一帧，防止分类或共享源变化后误判。 */
    reset(): void {
      previous = null
    },
  }
}
```

Create `src/stores/recognition.ts` with state fields `phase`, `message`, `running`, `lastCompletedFingerprint`, `resultSource`, and `durationMs`. Every Pinia action must have a Chinese method comment.

- [ ] **Step 4: Run focused tests and build**

Run:

```powershell
npm run test:run -- src/features/recognition/questionStabilizer.test.ts
npm run build
```

Expected: stabilizer tests PASS; the new store compiles.

- [ ] **Step 5: Commit**

```powershell
git add src/features/recognition/questionStabilizer.ts src/features/recognition/questionStabilizer.test.ts src/stores/recognition.ts
git commit -m "feat: stabilize continuous OCR questions"
```

---

### Task 6: Serial Recognition Controller

**Files:**
- Create: `src/features/recognition/useRecognitionController.ts`
- Test: `src/features/recognition/useRecognitionController.test.ts`
- Modify: `src/stores/matcher.ts`

**Interfaces:**
- Consumes: capture frame provider, OCR recognizer, category ID, query client, cache wrappers and Pinia stores.
- Produces: `start(): void`, `stop(): void`, `retry(): Promise<void>`, `resetForCategory(): void`.

- [ ] **Step 1: Write failing controller-policy tests**

Test the controller through injected `captureFrame`, `recognizeFrame`, `query`, `sleep`, `readCache` and `writeCache` functions. Required cases:

1. identical `frameHash` skips OCR;
2. two stable OCR results trigger one lookup;
3. cache hit skips both remote calls;
4. primary `empty` invokes exactly one fallback query;
5. timeout does not invoke fallback;
6. a completed fingerprint is not queried again;
7. `retry()` bypasses failure cooldown;
8. `stop()` aborts the active request and prevents late state updates.

Use fake timers only for the injected `sleep`; do not introduce production-only branches for tests.

- [ ] **Step 2: Run and verify failure**

Run `npm run test:run -- src/features/recognition/useRecognitionController.test.ts`.

Expected: FAIL because the controller module does not exist.

- [ ] **Step 3: Implement the controller**

Implement `useRecognitionController.ts` as a small dependency-injected controller. The public production factory creates defaults from `useScreenCapture`, `useOCR`, `queryRemoteQuestions`, cache wrappers and Pinia stores. Its internal solve sequence must be exactly:

```ts
/** 为一个已经稳定的题目执行缓存、远程查询、排序和结果发布。 */
async function solveStableQuestion(parsed: ParsedQuestion, ocrConfidence: number): Promise<void> {
  const startedAt = performance.now()
  const categoryId = configStore.config.remoteQuery.categoryId
  const fingerprint = createQuestionFingerprint(parsed.normalizedQuestion)
  if (!categoryId || fingerprint === recognitionStore.lastCompletedFingerprint) return

  activeRequestController?.abort()
  const requestController = new AbortController()
  activeRequestController = requestController

  recognitionStore.setPhase('cacheLookup', '正在查询本地缓存')
  const cached = await getRemoteQuestionCache(categoryId, fingerprint)
  if (cached) {
    publishCachedResult(cached, parsed, startedAt)
    return
  }

  recognitionStore.setPhase('primaryQuery', '正在查询远程题库')
  const primary = await queryRemoteQuestions(categoryId, cleanRemoteQueryText(parsed.questionText), {
    signal: requestController.signal,
    timeoutMs: configStore.config.remoteQuery.requestTimeoutMs,
  })
  let candidates = primary.kind === 'success' ? primary.candidates : []

  if (primary.kind === 'empty') {
    const fallback = selectFallbackKeyword(parsed.questionText)
    if (fallback) {
      recognitionStore.setPhase('fallbackQuery', '正在使用关键词重试')
      const secondary = await queryRemoteQuestions(categoryId, fallback, {
        signal: requestController.signal,
        timeoutMs: configStore.config.remoteQuery.requestTimeoutMs,
      })
      if (secondary.kind === 'success') candidates = secondary.candidates
      else if (secondary.kind !== 'empty') return publishFailure(secondary)
    }
  } else if (primary.kind !== 'success') {
    publishFailure(primary)
    return
  }

  recognitionStore.setPhase('matching', '正在匹配候选题')
  const decision = rankRemoteCandidates(parsed, candidates, ocrConfidence)
  await publishDecision(decision, categoryId, fingerprint, parsed, startedAt)
}
```

Declare `let activeRequestController: AbortController | null = null` in the controller closure. Implement the three referenced helpers with these exact contracts:

```ts
/** 发布缓存答案，并使用本次选项重新推导答案字母。 */
async function publishCachedResult(
  cached: RemoteQuestionCache,
  parsed: ParsedQuestion,
  startedAt: number,
): Promise<void>

/** 将远程错误映射为用户提示，并写入题目或分类冷却时间。 */
function publishFailure(result: Exclude<RemoteQueryResult, { kind: 'success' | 'empty' }>): void

/** 发布候选决策；仅 confident 和 lowConfidence 写入成功缓存。 */
async function publishDecision(
  decision: RemoteMatchDecision,
  categoryId: string,
  fingerprint: string,
  parsed: ParsedQuestion,
  startedAt: number,
): Promise<void>
```

`publishCachedResult` must call `inferRemoteAnswer(cached.answerText, parsed.options)`, update `lastUsedAt` and `hitCount`, persist the updated record, and publish a `MatchResult` with `resultSource: 'cache'`. `publishFailure` must map `corsBlocked`, `timeout`, `rateLimited`, `remoteError`, and `malformedResponse` to the messages defined in the design, set `waitingRetry`, and apply 60-second category cooldown only to `rateLimited`. `publishDecision` must set `waitingRetry` without caching for `rejected` and `ambiguous`; otherwise it must publish `answer`, `answerText`, `confidence`, `matchedQuestion`, `resultSource: 'remote'`, `durationMs`, and the low-confidence warning, then persist the `RemoteQuestionCache` record and mark the fingerprint completed.

The implementation must also:

- use a `while (running)` serial loop and injected `sleep(500)`;
- skip frames whose `frameHash` equals the last processed hash;
- require the stabilizer to return a stable question;
- compare the stable fingerprint with the last completed fingerprint;
- maintain a `Map<string, number>` for 10-second per-question failure cooldown;
- maintain a `Map<string, number>` for 60-second per-category rate-limit cooldown;
- create one `AbortController` per solve operation;
- ignore results when the solve generation no longer matches the active generation;
- allow `retry()` to clear the current question cooldown and run one immediate capture;
- clear matcher errors before each new attempt.

Update `src/stores/matcher.ts` so `setResult` clears stale errors and add a Chinese-commented `clear()` action.

- [ ] **Step 4: Run controller tests and full test suite**

Run:

```powershell
npm run test:run -- src/features/recognition/useRecognitionController.test.ts
npm run test:run
npm run build
```

Expected: controller tests and all earlier tests PASS; build succeeds.

- [ ] **Step 5: Commit**

```powershell
git add src/features/recognition/useRecognitionController.ts src/features/recognition/useRecognitionController.test.ts src/stores/matcher.ts
git commit -m "feat: orchestrate continuous question recognition"
```

---

### Task 7: Activity Category Configuration and Dashboard Integration

**Files:**
- Create: `src/data/activityCategories.ts`
- Modify: `src/types/config.ts`
- Modify: `src/stores/config.ts`
- Modify: `src/composables/useScreenCapture.ts`
- Modify: `src/components/Dashboard.vue`
- Modify: `src/components/AnswerOverlay.vue`
- Modify: `src/components/SettingsPanel.vue`
- Modify: `src/assets/styles/main.css`

**Interfaces:**
- Consumes: recognition controller and stores from Tasks 5–6.
- Produces: manual category selection, start/stop automatic recognition, manual retry, status and cache controls.

- [ ] **Step 1: Add the activity category list and persisted config**

Create `src/data/activityCategories.ts`:

```ts
import type { ActivityCategory } from '../types/remoteQuestion'

export const activityCategories: ActivityCategory[] = [
  { id: '44', name: '金兜洞兕大王' },
]
```

Add to `AppConfig` and `defaultAppConfig`:

```ts
remoteQuery: {
  categoryId: string
  requestTimeoutMs: number
}
```

```ts
remoteQuery: {
  categoryId: '',
  requestTimeoutMs: 1_500,
},
```

Change `defaultAppConfig.capture.captureFps` from `1` to `2` so the default serial-loop delay matches the confirmed two-frames-per-second target.

Add `selectActivityCategory(categoryId: string)` to `src/stores/config.ts`; it must clone the config, update `remoteQuery.categoryId`, and call the existing `update` action. Add a Chinese method comment.

In `useScreenCapture.ts`, add `onCaptureEnded(listener: () => void): () => void`. `startCapture()` must register the selected video track's `ended` event; the returned unsubscribe method removes the listener. `stopCapture()` must remain idempotent.

- [ ] **Step 2: Replace Dashboard's single-shot flow with the controller**

Remove `recognizeOnce`, local `busy`, direct `matchQuestion` invocation and automatic local question-index initialization from `Dashboard.vue`. Keep screen-capture start/stop ownership in the dashboard, but start the recognition controller only after capture succeeds and a category has been selected.

The top-bar controls must be:

```vue
<button type="button" :disabled="!selectedCategoryId" @click="startCapture">开始连续识别</button>
<button type="button" :disabled="!recognitionStore.running" @click="stopCapture">停止</button>
<button type="button" :disabled="captureStore.status !== 'active'" @click="controller.retry">手动重试</button>
```

The sidebar category selector must be:

```vue
<button
  v-for="category in activityCategories"
  :key="category.id"
  type="button"
  class="category-button"
  :class="{ active: selectedCategoryId === category.id }"
  @click="selectCategory(category.id)"
>
  {{ category.name }}
</button>
```

`selectCategory` must stop/reset the controller before persisting the new category. `onBeforeUnmount` must stop the controller, stop screen capture and terminate OCR.

Register the capture-ended callback and `document.visibilitychange` in `Dashboard.vue`. Capture end must stop the controller and set capture status to `paused`. When `document.hidden` becomes true, stop the controller and cancel its active request; returning to the page must not silently restart screen sharing. Remove both listeners during component unmount.

The status panel must show:

```vue
<p>阶段：{{ recognitionStore.message }}</p>
<p v-if="matcherStore.result?.resultSource">来源：{{ matcherStore.result.resultSource }}</p>
<p v-if="matcherStore.result?.durationMs">总耗时：{{ matcherStore.result.durationMs }}ms</p>
<p v-if="matcherStore.result?.warning" class="warning-text">{{ matcherStore.result.warning }}</p>
```

- [ ] **Step 3: Support text-only answers in the overlay**

Update `AnswerOverlay.vue` content to:

```vue
<div v-if="result" class="answer-overlay">
  <strong v-if="result.answer">答案：{{ result.answer }}</strong>
  <strong v-else>答案：{{ result.answerText }}</strong>
  <span>置信度 {{ Math.round(result.confidence * 100) }}%</span>
</div>
```

- [ ] **Step 4: Add cache clearing controls**

In `SettingsPanel.vue`, import the remote cache wrapper functions. Add buttons for clearing the selected category and all remote caches, with a visible success/error message. The methods `clearSelectedCategoryCache` and `clearRemoteCache` must have Chinese comments and must not clear capture configuration or unknown questions.

- [ ] **Step 5: Add focused styles**

Append to `src/assets/styles/main.css`:

```css
.category-button.active {
  border-color: var(--success);
  color: var(--bg);
  background: var(--success);
}

.warning-text {
  color: #f0b429;
}

.recognition-stage {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
}
```

- [ ] **Step 6: Run automated verification**

Run:

```powershell
npm run test:run
npm run build
```

Expected: all tests PASS; `vue-tsc --noEmit` and Vite build succeed.

- [ ] **Step 7: Commit**

```powershell
git add src/data/activityCategories.ts src/types/config.ts src/stores/config.ts src/composables/useScreenCapture.ts src/components/Dashboard.vue src/components/AnswerOverlay.vue src/components/SettingsPanel.vue src/assets/styles/main.css
git commit -m "feat: add realtime query controls"
```

---

### Task 8: Browser Acceptance and Documentation Alignment

**Files:**
- Modify: `docs/solution-design.md`
- Modify: `docs/crawler-and-db.md`

**Interfaces:**
- Consumes: completed feature from Tasks 1–7.
- Produces: verified static build and user-facing setup/query documentation.

- [ ] **Step 1: Start the production preview**

Run:

```powershell
npm run build
npm run preview
```

Expected: Vite prints a local preview URL and the page loads without console errors.

- [ ] **Step 2: Execute the browser acceptance checklist**

Verify in this order and record observed results in the implementation handoff:

1. With no category selected, automatic recognition cannot start.
2. Selecting “金兜洞兕大王” persists after refresh.
3. Starting capture enters continuous recognition and updates stage text.
4. Keeping the same question visible does not repeat remote requests.
5. A successful response is reused from IndexedDB after refresh.
6. Reordering answer options changes the inferred letter while preserving answer text.
7. A failed question exposes manual retry; retry bypasses the 10-second cooldown.
8. Stopping sharing cancels recognition and prevents new requests.
9. With cross-origin requests blocked, the UI says “可能是 CORS 或网络错误”.
10. A mocked or observed 403/429 pauses the selected category for 60 seconds.

- [ ] **Step 3: Update documentation**

In `docs/solution-design.md`, change the runtime lookup architecture from mandatory local JSON index to remote-first-on-cache-miss. Preserve the local JSON pipeline as an optional fallback/build capability. Document category selection, continuous recognition, one fallback query, cache behavior and CORS-extension requirement.

In `docs/crawler-and-db.md`, add a “运行时使用方式” section stating that the crawler is no longer required for normal users and that existing commands remain available for offline dataset maintenance.

- [ ] **Step 4: Run final verification**

Run:

```powershell
npm run test:run
npm run build
git diff --check
git status --short
```

Expected: all tests PASS; build succeeds; `git diff --check` prints nothing; status contains only the intended documentation changes plus any pre-existing user-owned crawler/data changes.

- [ ] **Step 5: Commit documentation only**

```powershell
git add docs/solution-design.md docs/crawler-and-db.md
git commit -m "docs: document realtime remote query flow"
```

Do not stage the pre-existing changes in `crawler/175dt-crawler.mjs`, `data/raw/175dt-categories.json`, `data/raw/questions.jsonl`, or `data/raw/questions.jsonl.state.json` unless the user separately requests them.
