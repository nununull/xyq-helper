import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { afterEach, describe, expect, it } from 'vitest'
import { createRemoteQuestionCacheRepository } from './remoteQuestionCache'

const databaseNames: string[] = []

/** 创建独立的真实 IndexedDB 数据库，避免测试间相互影响。 */
async function createDatabase() {
  const name = `xyq-helper-test-${crypto.randomUUID()}`
  databaseNames.push(name)
  return await openDB(name, 1, {
    upgrade(database) {
      database.createObjectStore('remote_question_cache', { keyPath: 'id' })
    },
  })
}

afterEach(async () => {
  for (const name of databaseNames.splice(0)) indexedDB.deleteDatabase(name)
})

describe('远程题目缓存', () => {
  it('按分类和题目指纹保存并读取成功结果', async () => {
    const db = await createDatabase()
    const repository = createRemoteQuestionCacheRepository(db)
    await repository.put({
      id: '44:abc', categoryId: '44', questionFingerprint: 'abc',
      recognizedQuestion: '诗鬼是谁', matchedQuestion: '诗鬼是谁', answerText: '李贺',
      source: '175dt', matchConfidence: 0.95, createdAt: 1, lastUsedAt: 1, hitCount: 1,
    })
    expect((await repository.get('44', 'abc'))?.answerText).toBe('李贺')
    db.close()
  })

  it('清理指定分类时保留其他分类的成功结果', async () => {
    const db = await createDatabase()
    const repository = createRemoteQuestionCacheRepository(db)
    await repository.put({
      id: '44:abc', categoryId: '44', questionFingerprint: 'abc',
      recognizedQuestion: '诗鬼是谁', matchedQuestion: '诗鬼是谁', answerText: '李贺',
      source: '175dt', matchConfidence: 0.95, createdAt: 1, lastUsedAt: 1, hitCount: 1,
    })
    await repository.put({
      id: '45:def', categoryId: '45', questionFingerprint: 'def',
      recognizedQuestion: '诗圣是谁', matchedQuestion: '诗圣是谁', answerText: '杜甫',
      source: '175dt', matchConfidence: 0.96, createdAt: 2, lastUsedAt: 2, hitCount: 1,
    })

    await repository.clearCategory('44')

    expect(await repository.get('44', 'abc')).toBeUndefined()
    expect((await repository.get('45', 'def'))?.answerText).toBe('杜甫')
    db.close()
  })

  it('清理全部缓存时清空所有成功结果', async () => {
    const db = await createDatabase()
    const repository = createRemoteQuestionCacheRepository(db)
    await repository.put({
      id: '44:abc', categoryId: '44', questionFingerprint: 'abc',
      recognizedQuestion: '诗鬼是谁', matchedQuestion: '诗鬼是谁', answerText: '李贺',
      source: '175dt', matchConfidence: 0.95, createdAt: 1, lastUsedAt: 1, hitCount: 1,
    })

    await repository.clearAll()

    expect(await repository.get('44', 'abc')).toBeUndefined()
    db.close()
  })
})
