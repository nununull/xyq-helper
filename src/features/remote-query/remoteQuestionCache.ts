import type { IDBPDatabase } from 'idb'
import type { RemoteQuestionCache } from '../../types/remoteQuestion'

export interface RemoteQuestionCacheRepository {
  get(categoryId: string, fingerprint: string): Promise<RemoteQuestionCache | undefined>
  put(record: RemoteQuestionCache): Promise<void>
  clearCategory(categoryId: string): Promise<void>
  clearAll(): Promise<void>
}

/** 基于给定数据库创建远程成功结果仓储，便于生产代码和独立数据库复用。 */
export function createRemoteQuestionCacheRepository(db: IDBPDatabase): RemoteQuestionCacheRepository {
  return {
    /** 按活动分类和题目指纹读取一个远程成功结果。 */
    async get(categoryId, fingerprint) {
      return await db.get('remote_question_cache', `${categoryId}:${fingerprint}`) as RemoteQuestionCache | undefined
    },

    /** 保存或覆盖一个远程成功结果。 */
    async put(record) {
      await db.put('remote_question_cache', record)
    },

    /** 清理指定活动分类下的所有远程成功结果。 */
    async clearCategory(categoryId) {
      const transaction = db.transaction('remote_question_cache', 'readwrite')
      let cursor = await transaction.store.openCursor()
      while (cursor) {
        const record = cursor.value as RemoteQuestionCache
        if (record.categoryId === categoryId) await cursor.delete()
        cursor = await cursor.continue()
      }
      await transaction.done
    },

    /** 清理全部远程成功结果。 */
    async clearAll() {
      await db.clear('remote_question_cache')
    },
  }
}
