import type { IncomingMessage, ServerResponse } from 'node:http'

/** 创建仅转发175dt截图识别的同源HTTP中间件。 */
export function create175dtProxy(options?: {
  fetcher?: typeof fetch
  logger?: Pick<Console, 'info' | 'error'>
}): (request: IncomingMessage, response: ServerResponse, next?: () => void) => Promise<void>
