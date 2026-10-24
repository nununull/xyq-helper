import { createHash, randomUUID } from 'node:crypto'
import { MAX_IMAGE_BYTES, MIN_QUERY_INTERVAL_MS, RATE_LIMIT_COOLDOWN_MS, UPSTREAM_TIMEOUT_MS } from '../shared/recognition-policy.mjs'

const UPSTREAM_ORIGIN = 'https://175dt.com'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
const BOOTSTRAP_KEY = 'OoOoOoOoOoOoOoOoOoOoOoOoOoOoOoOo'

/** 输出单行JSON响应，不向客户端暴露临时签名和匿名会话。 */
function sendJson(response, status, payload) {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(payload))
}

/** 限制上传大小并完整读取图片原始字节。 */
async function readImage(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_IMAGE_BYTES) throw new Error('图片超过1MB，请缩小题干选框')
    chunks.push(chunk)
  }
  const image = Buffer.concat(chunks)
  const png = image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpeg = image.length >= 3 && image[0] === 255 && image[1] === 216 && image[2] === 255
  if (!png && !jpeg) throw new Error('请上传PNG或JPEG题干截图')
  return image
}

/** 创建固定目标的175dt转发入口，处理匿名会话、图片签名和请求取消。 */
export function create175dtProxy({ fetcher = fetch, logger = console } = {}) {
  let sessionPromise = null
  let nextQueryAt = 0

  /** 请求175dt并保留其业务状态，HTTP拒绝与协议异常单独处理。 */
  async function fetchJson(url, init) {
    const response = await fetcher(url, init)
    if (!response.ok) {
      const error = new Error(`175dt接口返回HTTP ${response.status}`)
      error.status = response.status
      if (response.status === 401 || response.status === 422) sessionPromise = null
      if (response.status === 403 || response.status === 429) nextQueryAt = Date.now() + RATE_LIMIT_COOLDOWN_MS
      throw error
    }
    return await response.json()
  }

  /** 复用官网自动下发的匿名会话，exp=0不代表需要扫码授权。 */
  async function getSession(common) {
    if (!sessionPromise) {
      sessionPromise = fetchJson(`${UPSTREAM_ORIGIN}/api/key`, {
        method: 'POST', headers: { ...common, key: BOOTSTRAP_KEY, exp: '0' },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      }).then(payload => {
        if (typeof payload?.key !== 'string' || !payload.key || payload.exp === undefined) {
          throw new Error('175dt匿名会话格式发生变化')
        }
        return { key: payload.key, exp: String(payload.exp) }
      }).catch(error => { sessionPromise = null; throw error })
    }
    return await sessionPromise
  }

  /** 处理同源识别请求，并在浏览器断开时中止在途上游请求。 */
  return async function handle175dtRequest(request, response, next = () => {}) {
    let url
    try {
      url = new URL(request.url ?? '/', 'http://localhost')
    } catch {
      sendJson(response, 400, { message: '请求路径无效' })
      return
    }
    if (!url.pathname.startsWith('/api/175dt/')) return next()
    if (url.pathname === '/api/175dt/health' && request.method === 'GET') {
      sendJson(response, 200, { available: true })
      return
    }
    if (url.pathname !== '/api/175dt/recognize' || request.method !== 'POST') {
      sendJson(response, 404, { message: '未找到175dt接口' })
      return
    }
    const categoryId = url.searchParams.get('id') ?? ''
    if (!/^\d{1,5}$/.test(categoryId)) {
      sendJson(response, 400, { message: '请选择有效的活动分类' })
      return
    }
    if (Date.now() < nextQueryAt) {
      response.setHeader('Retry-After', Math.ceil((nextQueryAt - Date.now()) / 1000))
      sendJson(response, 429, { message: '查询过快，请稍后重试' })
      return
    }

    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)])
    const requestId = randomUUID()
    const startedAt = Date.now()
    /** 只在响应尚未写完时将客户端断开传播给上游。 */
    function cancelDisconnectedRequest() {
      if (!response.writableEnded) controller.abort()
    }
    request.once('aborted', cancelDisconnectedRequest)
    response.once('close', cancelDisconnectedRequest)
    try {
      const image = await readImage(request)
      signal.throwIfAborted()
      // 再次检查预算，防止并发上传绕过最小查询间隔。
      if (Date.now() < nextQueryAt) {
        sendJson(response, 429, { message: '查询过快，请稍后重试' })
        return
      }
      nextQueryAt = Date.now() + MIN_QUERY_INTERVAL_MS
      const imageSha256 = createHash('sha256').update(image).digest('hex')
      logger.info(JSON.stringify({ msg: '开始175dt截图识别', requestId, categoryId, imageBytes: image.length, imageSha256, contentType: request.headers['content-type'] }))
      const common = { Origin: UPSTREAM_ORIGIN, Referer: `${UPSTREAM_ORIGIN}/${categoryId}`, 'User-Agent': USER_AGENT }
      const session = await getSession(common)
      signal.throwIfAborted()
      const headers = { ...common, ...session, 'x-acs-content-sha256': imageSha256 }
      const signature = await fetchJson(`https://o.175dt.com/?id=${categoryId}`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'img-sha256': imageSha256 }, signal,
      })
      let result = signature
      if (signature?.status === undefined) {
        const signedHeaders = {}
        for (const name of ['authorization', 'x-acs-date', 'x-request-id']) {
          if (typeof signature?.[name] !== 'string' || !signature[name]) throw new Error('175dt上传签名格式发生变化')
          signedHeaders[name] = signature[name]
        }
        result = await fetchJson(`https://ocr-dt-abetrciweb.cn-hangzhou.fcapp.run/?id=${categoryId}`, {
          method: 'POST', headers: { ...headers, ...signedHeaders, 'Content-Type': 'application/octet-stream' }, body: image, signal,
        })
      }
      if (typeof result?.status !== 'number') throw new Error('175dt识别结果格式发生变化')
      logger.info(JSON.stringify({ msg: '完成175dt截图识别', requestId, categoryId, status: result.status, candidateCount: Array.isArray(result.hits) ? result.hits.length : 0, durationMs: Date.now() - startedAt }))
      sendJson(response, 200, result)
    } catch (error) {
      if (controller.signal.aborted) return
      const status = signal.aborted ? 504 : error.status === 403 || error.status === 429 ? 429 : 502
      const message = signal.aborted ? '175dt识别超时，请手动重试' : error.message
      logger.error(JSON.stringify({ msg: '175dt截图识别失败', requestId, categoryId, message, durationMs: Date.now() - startedAt }))
      sendJson(response, status, { message })
    } finally {
      request.removeListener('aborted', cancelDisconnectedRequest)
      response.removeListener('close', cancelDisconnectedRequest)
    }
  }
}
