import { describe, expect, it, vi } from 'vitest'
import { queryRemoteAuthorization, queryRemoteScreenshot } from './remoteScreenshotClient'

describe('175dt截图客户端', () => {
  it('只上传图片二进制，清洗官网返回的标签并保留候选顺序', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      status: 200, hits: [{ q: '<b>诗鬼是谁</b>', a: '李贺' }], extra: true,
    })))
    const blob = new Blob(['png'], { type: 'image/png' })
    const result = await queryRemoteScreenshot('53', blob, { fetcher })
    expect(fetcher).toHaveBeenCalledWith('/api/175dt/recognize?id=53', expect.objectContaining({
      method: 'POST', body: blob, headers: { 'Content-Type': 'image/png' },
    }))
    expect(result).toEqual({ kind: 'success', candidates: [
      { question: '诗鬼是谁', answerText: '李贺', source: '175dt' },
    ] })
  })

  it('把截图过大、活动时间和官方授权错误转换为明确提示', async () => {
    for (const [status, message] of [[175000001, '只框选题干'], [175000006, '活动时间']] as const) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status })))
      expect(await queryRemoteScreenshot('53', new Blob(), { fetcher })).toMatchObject({
        kind: 'remoteError', message: expect.stringContaining(message),
      })
    }
  })

  it('官方授权失效使用独立结果，和普通识别失败区分', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 1234 })))
    expect(await queryRemoteScreenshot('53', new Blob(), { fetcher })).toMatchObject({
      kind: 'authorizationRequired', message: expect.stringContaining('授权面板'),
    })
  })

  it('请求被取消后不会把迟到的响应当成成功', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort()
      return new Response(JSON.stringify({ status: 200, hits: [{ q: '旧题', a: '旧答案' }] }))
    })
    expect(await queryRemoteScreenshot('53', new Blob(), { fetcher, signal: controller.signal }))
      .toMatchObject({ kind: 'timeout' })
  })

  it('答案中的转义尖括号不会被当作网页标签删掉，异常实体也不会中断识别', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      status: 200, hits: [{ q: '诗鬼是谁&#x110000;', a: '&lt;李贺&gt;' }],
    })))
    expect(await queryRemoteScreenshot('53', new Blob(), { fetcher })).toMatchObject({
      kind: 'success', candidates: [{ question: '诗鬼是谁&#x110000;', answerText: '<李贺>', source: '175dt' }],
    })
  })
})

describe('175dt官方授权', () => {
  it('未授权时返回官方二维码，通过POST确认当前会话', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      status: 200, authorized: false, qrCodeUrl: 'https://mp-175dt.oss-cn-hangzhou.aliyuncs.com/session.webp', extra: true,
    })))
    expect(await queryRemoteAuthorization({ fetcher })).toEqual({
      authorized: false, qrCodeUrl: 'https://mp-175dt.oss-cn-hangzhou.aliyuncs.com/session.webp',
    })
    expect(fetcher).toHaveBeenCalledWith('/api/175dt/authorization', expect.objectContaining({ method: 'POST' }))
  })

  it('授权成功只保留官网有效期，额外字段不进入页面状态', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      status: 200, authorized: true, expiresAt: '2100-01-01 08:00:00', key: '不应返回页面的会话字段',
    })))
    expect(await queryRemoteAuthorization({ fetcher })).toEqual({ authorized: true, expiresAt: '2100-01-01 08:00:00' })
  })

  it('HTTP200包装的确认失败仍显示错误，不能当成授权成功', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 500, message: '授权状态确认失败，请重试' })))
    await expect(queryRemoteAuthorization({ fetcher })).rejects.toThrow('授权状态确认失败')
  })
})
