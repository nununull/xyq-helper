import type { CaptureFrame } from '../../types/capture'
import type { RemoteQueryOptions, RemoteQueryResult, RemoteQuestionCandidate } from '../../types/remoteQuestion'
import { sanitizeRemoteAnswer, sanitizeRemoteText } from '../../utils/sanitizeRemoteText'
import { CLIENT_TIMEOUT_MS, MAX_IMAGE_BYTES } from '../../../shared/recognition-policy.mjs'

/** 将题干原始像素编码为PNG，不放大、不二值化、不附带选项或整张窗口。 */
export async function encodeQuestionScreenshot(frame: CaptureFrame): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = frame.questionImage.width
  canvas.height = frame.questionImage.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建题干截图')
  context.putImageData(frame.questionImage, 0, 0)
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('题干图片编码失败')), 'image/png')
  })
}

/** 通过同源转发向175dt上传题干截图，答案仅采用官网返回内容。 */
export async function queryRemoteScreenshot(
  categoryId: string,
  image: Blob,
  options: RemoteQueryOptions = {},
): Promise<RemoteQueryResult> {
  if (image.size > MAX_IMAGE_BYTES) return { kind: 'remoteError', message: '截图过大，请重新校准，只框选题干，不包含选项' }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? CLIENT_TIMEOUT_MS)
  /** 将外部停止操作同步到当前图片上传。 */
  const cancel = () => controller.abort()
  if (options.signal?.aborted) cancel()
  else options.signal?.addEventListener('abort', cancel, { once: true })
  try {
    const response = await (options.fetcher ?? fetch)(`/api/175dt/recognize?id=${encodeURIComponent(categoryId)}`, {
      method: 'POST', body: image, headers: { 'Content-Type': image.type || 'image/png' }, signal: controller.signal,
    })
    const payload: unknown = await response.json()
    if (controller.signal.aborted) return { kind: 'timeout', message: '请求已取消' }
    if (response.status === 429 || response.status === 403) return { kind: 'rateLimited', message: '175dt请求过快，请等待一分钟后手动重试', status: response.status }
    if (!response.ok) {
      const message = readMessage(payload) || '175dt识别服务不可用，请检查服务是否已启动'
      return { kind: 'remoteError', message, status: response.status }
    }
    if (!payload || typeof payload !== 'object') return { kind: 'malformedResponse', message: '175dt返回格式发生变化' }
    const result = payload as { status?: number; hits?: Array<{ q?: unknown; a?: unknown }> }
    if (result.status === 404) return { kind: 'empty', candidates: [] }
    if (result.status !== 200) {
      const message = result.status === 175000001 ? '截图过大，请重新校准，只框选题干，不包含选项'
        : result.status === 175000006 ? '当前不在该活动时间，请检查活动分类'
          : readMessage(payload) || `175dt未能识别此图（${result.status ?? '未知状态'}），请检查题干选框后手动重试`
      return { kind: 'remoteError', message }
    }
    if (!Array.isArray(result.hits) || result.hits.some(hit => typeof hit?.q !== 'string' || typeof hit?.a !== 'string')) {
      return { kind: 'malformedResponse', message: '175dt题目格式发生变化' }
    }
    const candidates = result.hits.map((hit): RemoteQuestionCandidate => ({
      question: sanitizeRemoteText(hit.q as string), answerText: sanitizeRemoteAnswer(hit.a as string), source: '175dt',
    })).filter(item => item.question && item.answerText)
    return candidates.length ? { kind: 'success', candidates } : { kind: 'empty', candidates: [] }
  } catch (error) {
    if (controller.signal.aborted) return { kind: 'timeout', message: options.signal?.aborted ? '请求已取消' : '175dt识别超时，请手动重试' }
    return { kind: 'remoteError', message: error instanceof SyntaxError ? '当前站点没有配置175dt识别服务，请使用本机启动版' : '无法连接175dt识别服务，请检查网络后手动重试' }
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', cancel)
  }
}

/** 读取转发服务返回的中文错误信息。 */
function readMessage(payload: unknown): string {
  return payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string' ? payload.message : ''
}
