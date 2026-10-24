import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { create175dtProxy } from './175dt-proxy.mjs'

const root = fileURLToPath(new URL('../dist/', import.meta.url))
const proxy = create175dtProxy()
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' }

/** 从构建目录提供静态页面，拒绝越过目录边界的路径。 */
async function serveStatic(request, response) {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    const target = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (target !== root && !target.startsWith(root.endsWith(sep) ? root : root + sep)) throw new Error('无效路径')
    const data = await readFile(target)
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(target)] ?? 'application/octet-stream' })
    response.end(data)
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('页面不存在，请先执行 npm run build')
  }
}

const port = Number(process.env.PORT ?? 4173)
const server = createServer((request, response) => {
  void proxy(request, response, () => { void serveStatic(request, response) }).catch(error => {
    console.error(JSON.stringify({ msg: '请求处理异常', message: error.message }))
    if (!response.destroyed && !response.writableEnded) {
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ message: '识别服务暂时不可用，请重试' }))
    }
  })
})
server.listen(port, '127.0.0.1', () => {
  console.info(JSON.stringify({ msg: '答题助手已启动', address: `http://127.0.0.1:${port}` }))
})
