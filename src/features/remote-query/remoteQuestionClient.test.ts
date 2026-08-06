import { describe, expect, it, vi } from 'vitest'
import { queryRemoteQuestions } from './remoteQuestionClient'

/** 构造会在请求取消时结束的挂起请求。 */
function createAbortAwareFetcher() {
  return vi.fn((_: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
  }))
}

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

  it('清理高亮标签和常见 HTML 实体', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      status: 200,
      hits: [{ q: ' <em>诗鬼</em>&nbsp;是谁&amp; ', a: '&lt;李贺&gt;' }],
    }), { status: 200 }))

    await expect(queryRemoteQuestions('44', '诗鬼', { fetcher })).resolves.toEqual({
      kind: 'success',
      candidates: [{ question: '诗鬼 是谁&', answerText: '<李贺>', source: '175dt' }],
    })
  })

  it('在没有有效候选题时返回空结果', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: 200, hits: [] }), { status: 200 }))

    await expect(queryRemoteQuestions('44', '诗鬼', { fetcher })).resolves.toEqual({ kind: 'empty', candidates: [] })
  })

  it.each([403, 429])('把 %s 识别为限流', async (status) => {
    const fetcher = vi.fn(async () => new Response('', { status }))
    const result = await queryRemoteQuestions('44', '诗鬼', { fetcher })
    expect(result.kind).toBe('rateLimited')
  })

  it('把格式异常的响应归类为 malformedResponse', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: 200, hits: [{ q: '题干' }] }), { status: 200 }))

    await expect(queryRemoteQuestions('44', '诗鬼', { fetcher })).resolves.toMatchObject({
      kind: 'malformedResponse',
    })
  })

  it('把真实非 JSON 的 200 响应归类为 malformedResponse', async () => {
    const fetcher = vi.fn(async () => new Response('<html>upstream changed</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    }))

    await expect(queryRemoteQuestions('44', '诗鬼', { fetcher })).resolves.toEqual({
      kind: 'malformedResponse',
      message: '远程接口格式发生变化',
    })
  })

  it('把网络 TypeError 归类为可能的跨域错误', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    const result = await queryRemoteQuestions('44', '诗鬼', { fetcher })
    expect(result.kind).toBe('corsBlocked')
  })

  it('超时后返回 timeout', async () => {
    const fetcher = createAbortAwareFetcher()

    await expect(queryRemoteQuestions('44', '诗鬼', { fetcher, timeoutMs: 10 })).resolves.toMatchObject({
      kind: 'timeout',
      message: '远程题库响应超时',
    })
  })

  it('外部取消后返回 timeout', async () => {
    const controller = new AbortController()
    const fetcher = createAbortAwareFetcher()
    const request = queryRemoteQuestions('44', '诗鬼', { fetcher, signal: controller.signal })
    controller.abort()

    await expect(request).resolves.toMatchObject({ kind: 'timeout', message: '请求已取消' })
  })
})
