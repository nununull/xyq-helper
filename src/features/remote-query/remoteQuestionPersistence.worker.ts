/// <reference lib="webworker" />
import { listUserQuestions, putUserQuestions } from '../../composables/useLocalStorageDB'
import type { RemoteQuestionCandidate } from '../../types/remoteQuestion'
import { createRemoteQuestionRecords } from './remoteQuestionRecords'

interface PersistenceRequest {
  id: number
  categoryId: string
  candidates: RemoteQuestionCandidate[]
}

/** 在线程内完成远程题目去重和 IndexedDB 写入。 */
self.addEventListener('message', (event: MessageEvent<PersistenceRequest>) => {
  const { id, categoryId, candidates } = event.data
  void persistRemoteQuestions(categoryId, candidates).then(
    (count) => self.postMessage({ id, count }),
    (error: unknown) => self.postMessage({
      id,
      error: error instanceof Error ? error.message : '远程题目入库失败',
    }),
  )
})

/** 读取已有记录并只写入发生变化的远程题目。 */
async function persistRemoteQuestions(
  categoryId: string,
  candidates: RemoteQuestionCandidate[],
): Promise<number> {
  const existingRecords = await listUserQuestions()
  const changedRecords = createRemoteQuestionRecords(existingRecords, categoryId, candidates)
  await putUserQuestions(changedRecords)
  return changedRecords.length
}
