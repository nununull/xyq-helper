import { createServer, request } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { create175dtProxy } from './175dt-proxy.mjs'

const servers: ReturnType<typeof createServer>[] = []
const sessionFiles: string[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  await Promise.all(sessionFiles.splice(0).map(async file => {
    await rm(file, { force: true })
    await rmdir(dirname(file))
  }))
})

/** 创建独立会话目录和真实HTTP入口，防止测试覆盖本机授权。 */
async function startProxy(fetcher: typeof fetch, sessionFile?: string) {
  if (!sessionFile) {
    sessionFile = join(await mkdtemp(join(tmpdir(), 'xyq-175dt-test-')), 'session.key')
    sessionFiles.push(sessionFile)
  }
  const handler = create175dtProxy({ fetcher, sessionFile, logger: { info: vi.fn(), error: vi.fn() } })
  const server = createServer((req, res) => { void handler(req, res) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  return { baseUrl: `http://127.0.0.1:${port}`, sessionFile }
}

/** 向真实本地HTTP入口发送PNG请求，检查流式读取和上游协议。 */
async function upload(fetcher: typeof fetch, concurrent = false) {
  const { baseUrl } = await startProxy(fetcher)
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
  /** 向同一个转发实例发请求，检验跨连接的限流预算。 */
  const send = () => new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = request(`${baseUrl}/api/175dt/recognize?id=53`, {
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
    // 按官网实际路由响应，旧签名域名必须暴露404，不能被顺序桩掩盖。
    const fetcher = vi.fn<typeof fetch>(async input => {
      const url = String(input)
      if (url === 'https://175dt.com/api/key') return new Response(JSON.stringify({ key: 'anonymous', exp: 0 }))
      if (url === 'https://175dt.com/api/ocr?id=53') return new Response(JSON.stringify({
        authorization: 'ACS3 signature', 'x-acs-date': '2026-10-24T04:32:33Z', 'x-request-id': 'sample',
      }))
      if (url === 'https://ocr-dt-abetrciweb.cn-hangzhou.fcapp.run/?id=53') {
        return new Response(JSON.stringify({ status: 200, hits: [{ q: '诗鬼是谁', a: '李贺' }] }))
      }
      return new Response(JSON.stringify({ error_msg: '404 Route Not Found' }), { status: 404 })
    })
    expect(await upload(fetcher)).toMatchObject({ status: 200, body: { status: 200 } })
    expect(new Headers(fetcher.mock.calls[0]![1]!.headers).get('key')).toBe('11111111111111111111111111111111')
    const last = fetcher.mock.calls[2]!
    const headers = new Headers(last[1]!.headers)
    expect(headers.get('origin')).toBe('https://175dt.com')
    expect(headers.get('exp')).toBe('0')
    expect(headers.get('x-acs-date')).toBe('2026-10-24T04:32:33Z')
    expect(headers.get('content-type')).toBe('application/octet-stream')
    expect(last[1]!.body).toBeInstanceOf(Buffer)
    expect(headers.get('x-acs-content-sha256')).toHaveLength(64)
  })

  it('上游签名入口失效时报告真实请求地址，不继续上传图片', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ key: 'anonymous', exp: 0 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error_msg: '404 Route Not Found' }), { status: 404 }))
    expect(await upload(fetcher)).toMatchObject({
      status: 502,
      body: { message: expect.stringContaining('POST https://175dt.com/api/ocr?id=53') },
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
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

  it('扫码后刷新同一个会话，后续识别使用官网确认的授权有效期', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ key: 'scan-session', exp: 0 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ key: 'scan-session', exp: 4102444800 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 200, hits: [{ q: '题目', a: '答案' }] })))
    const { baseUrl, sessionFile } = await startProxy(fetcher)
    const pending = await fetch(`${baseUrl}/api/175dt/authorization`, { method: 'POST' })
    expect(await pending.json()).toEqual({
      status: 200, authorized: false, qrCodeUrl: 'https://mp-175dt.oss-cn-hangzhou.aliyuncs.com/scan-session.webp',
    })
    const confirmed = await fetch(`${baseUrl}/api/175dt/authorization`, { method: 'POST' })
    expect(await confirmed.json()).toEqual({ status: 200, authorized: true, expiresAt: '2100-01-01 08:00:00' })
    const refreshedHeaders = new Headers(fetcher.mock.calls[1]![1]!.headers)
    expect(refreshedHeaders.get('key')).toBe('scan-session')
    expect(refreshedHeaders.get('exp')).toBe('0')
    const recognized = await fetch(`${baseUrl}/api/175dt/recognize?id=53`, {
      method: 'POST', body: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]),
    })
    expect(await recognized.json()).toMatchObject({ status: 200 })
    const recognizedHeaders = new Headers(fetcher.mock.calls[2]![1]!.headers)
    expect(recognizedHeaders.get('key')).toBe('scan-session')
    expect(recognizedHeaders.get('exp')).toBe('4102444800')
    expect(await readFile(sessionFile, 'utf8')).toBe('scan-session')
  })

  it('重启后复用保存的会话标识，授权状态重新向官网确认', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ key: 'saved-session', exp: 4102444800 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ key: 'saved-session', exp: 0 })))
    const first = await startProxy(fetcher)
    await writeFile(first.sessionFile, 'saved-session')
    expect(await (await fetch(`${first.baseUrl}/api/175dt/authorization`, { method: 'POST' })).json())
      .toMatchObject({ authorized: true })
    const restarted = await startProxy(fetcher, first.sessionFile)
    expect(await (await fetch(`${restarted.baseUrl}/api/175dt/authorization`, { method: 'POST' })).json())
      .toMatchObject({ authorized: false, qrCodeUrl: 'https://mp-175dt.oss-cn-hangzhou.aliyuncs.com/saved-session.webp' })
    expect(new Headers(fetcher.mock.calls[0]![1]!.headers).get('key')).toBe('saved-session')
    expect(new Headers(fetcher.mock.calls[1]![1]!.headers).get('key')).toBe('saved-session')
    expect(await readFile(first.sessionFile, 'utf8')).toBe('saved-session')
  })

  it('授权确认失败仍保留原会话，重试时二维码不换号', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ key: 'scan-session', exp: 0 })))
      .mockRejectedValueOnce(new Error('临时网络中断'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ key: 'scan-session', exp: 0 })))
    const { baseUrl } = await startProxy(fetcher)
    await fetch(`${baseUrl}/api/175dt/authorization`, { method: 'POST' })
    const failed = await fetch(`${baseUrl}/api/175dt/authorization`, { method: 'POST' })
    expect(failed.status).toBe(200)
    expect(await failed.json()).toMatchObject({ status: 500, message: expect.any(String) })
    const retried = await fetch(`${baseUrl}/api/175dt/authorization`, { method: 'POST' })
    expect(await retried.json()).toMatchObject({
      authorized: false, qrCodeUrl: 'https://mp-175dt.oss-cn-hangzhou.aliyuncs.com/scan-session.webp',
    })
    expect(new Headers(fetcher.mock.calls[2]![1]!.headers).get('key')).toBe('scan-session')
  })
})
