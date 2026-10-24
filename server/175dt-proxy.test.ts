import { createServer, request } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { create175dtProxy } from './175dt-proxy.mjs'

const servers: ReturnType<typeof createServer>[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})

/** 向真实本地HTTP入口发送PNG请求，检查流式读取和上游协议。 */
async function upload(fetcher: typeof fetch, concurrent = false) {
  const handler = create175dtProxy({ fetcher, logger: { info: vi.fn(), error: vi.fn() } })
  const server = createServer((req, res) => { void handler(req, res) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
  /** 向同一个转发实例发请求，检验跨连接的限流预算。 */
  const send = () => new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = request(`http://127.0.0.1:${port}/api/175dt/recognize?id=53`, {
      method: 'POST', headers: { 'Content-Type': 'image/png' },
    }, res => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(body) }))
    })
    req.on('error', reject)
    req.end(bytes)
  })
  return concurrent ? await Promise.all([send(), send()]) : await send()
}

describe('175dt同源转发', () => {
  it('匿名会话exp=0仍可识别，保留签名原文且二进制哈希与请求体一致', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ key: 'anonymous', exp: 0 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        authorization: 'ACS3 signature', 'x-acs-date': '2026-10-24T04:32:33Z', 'x-request-id': 'sample',
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 200, hits: [{ q: '诗鬼是谁', a: '李贺' }] })))
    expect(await upload(fetcher)).toMatchObject({ status: 200, body: { status: 200 } })
    const last = fetcher.mock.calls[2]!
    const headers = new Headers(last[1]!.headers)
    expect(headers.get('origin')).toBe('https://175dt.com')
    expect(headers.get('exp')).toBe('0')
    expect(headers.get('x-acs-date')).toBe('2026-10-24T04:32:33Z')
    expect(headers.get('content-type')).toBe('application/octet-stream')
    expect(last[1]!.body).toBeInstanceOf(Buffer)
    expect(headers.get('x-acs-content-sha256')).toHaveLength(64)
  })

  it('官网已返回结果时不再上传图片', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ key: 'anonymous', exp: 0 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 200, hits: [{ q: '问题', a: '答案' }] })))
    expect(await upload(fetcher)).toMatchObject({ status: 200 })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('两个并发请求共用两秒预算，只允许一个进入175dt', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ key: 'anonymous', exp: 0 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 200, hits: [{ q: '问题', a: '答案' }] })))
    const responses = await upload(fetcher, true)
    expect(Array.isArray(responses) && responses.map(response => response.status).sort()).toEqual([200, 429])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('畸形路径返回400，不产生能终止服务的异步拒绝', async () => {
    const handler = create175dtProxy()
    const req = { url: '//[', method: 'GET' } as IncomingMessage
    const res = { destroyed: false, writableEnded: false, writeHead: vi.fn(), end: vi.fn() }
    await expect(handler(req, res as unknown as ServerResponse)).resolves.toBeUndefined()
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object))
  })
})
