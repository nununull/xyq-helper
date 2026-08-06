import type {
  RemoteQueryOptions,
  RemoteQueryResult,
  RemoteQuestionCandidate,
} from '../../types/remoteQuestion'
import { cleanRemoteQueryText } from './queryText'

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

  if (options.signal?.aborted) {
    cancel()
  } else {
    options.signal?.addEventListener('abort', cancel, { once: true })
  }

  const url = new URL(endpoint)
  url.search = new URLSearchParams({ id: categoryId, kw: cleanRemoteQueryText(queryText), c: '10000' }).toString()

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
      return { kind: 'malformedResponse', message: '远程接口格式发生变化' }
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
    if (error instanceof SyntaxError) {
      return { kind: 'malformedResponse', message: '远程接口格式发生变化' }
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
