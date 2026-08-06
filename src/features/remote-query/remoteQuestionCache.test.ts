import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { afterEach, describe, expect, it } from 'vitest'
import { createRemoteQuestionCacheRepository } from './remoteQuestionCache'
import { upgradeLocalStorageDatabase } from '../../composables/useLocalStorageDB'

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
  it('从 v1 升级到 v2 时保留旧 store 和数据并创建远程缓存 store', async () => {
    const name = `xyq-helper-test-${crypto.randomUUID()}`
    databaseNames.push(name)
    const v1Database = await openDB(name, 1, {
      /** 构造升级前的 v1 本地数据库结构。 */
      upgrade(database) {
        database.createObjectStore('config')
        database.createObjectStore('unknown_questions', { keyPath: 'id', autoIncrement: true })
        database.createObjectStore('user_questions', { keyPath: 'id', autoIncrement: true })
      },
    })
    await v1Database.put('config', { enabled: true }, 'app')
    await v1Database.add('unknown_questions', {
      question: '旧未知题', options: {}, ocrConfidence: 0.5, createdAt: '2026-08-06', status: 'pending',
    })
    await v1Database.add('user_questions', { question: '旧用户题' })
    v1Database.close()

    const v2Database = await openDB(name, 2, { upgrade: upgradeLocalStorageDatabase })

    expect(v2Database.objectStoreNames.contains('config')).toBe(true)
    expect(v2Database.objectStoreNames.contains('unknown_questions')).toBe(true)
    expect(v2Database.objectStoreNames.contains('user_questions')).toBe(true)
    expect(v2Database.objectStoreNames.contains('remote_question_cache')).toBe(true)
    expect(await v2Database.get('config', 'app')).toEqual({ enabled: true })
    expect((await v2Database.getAll('unknown_questions'))[0]).toMatchObject({ question: '旧未知题' })
    expect((await v2Database.getAll('user_questions'))[0]).toMatchObject({ question: '旧用户题' })
    v2Database.close()
  })
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
