import type { RemoteQuestionCandidate } from '../../types/remoteQuestion'

interface PersistenceResponse {
  id: number
  count?: number
  error?: string
}

interface PendingPersistence {
  resolve(count: number): void
  reject(error: Error): void
}

let persistenceWorker: Worker | null = null
let nextRequestId = 1
const pendingRequests = new Map<number, PendingPersistence>()

/** 获取可复用的远程题目入库线程，并接管线程响应。 */
function getPersistenceWorker(): Worker {
  if (persistenceWorker) return persistenceWorker

  const worker = new Worker(new URL('./remoteQuestionPersistence.worker.ts', import.meta.url), {
    type: 'module',
  })
  worker.addEventListener('message', (event: MessageEvent<PersistenceResponse>) => {
    const pending = pendingRequests.get(event.data.id)
    if (!pending) return
    pendingRequests.delete(event.data.id)
    if (event.data.error) {
      pending.reject(new Error(event.data.error))
      return
    }
    pending.resolve(event.data.count ?? 0)
  })
  worker.addEventListener('error', (event) => {
    const error = new Error(event.message || '远程题目入库线程异常')
    for (const pending of pendingRequests.values()) pending.reject(error)
    pendingRequests.clear()
    persistenceWorker = null
    worker.terminate()
  })
  persistenceWorker = worker
  return worker
}

/** 把远程题目发送到独立 Worker 入库，主线程只等待处理结果。 */
export async function persistRemoteQuestionsInWorker(
  categoryId: string,
  candidates: RemoteQuestionCandidate[],
): Promise<number> {
  if (candidates.length === 0) return 0
  const id = nextRequestId++
  return await new Promise<number>((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject })
    getPersistenceWorker().postMessage({ id, categoryId, candidates })
  })
}
