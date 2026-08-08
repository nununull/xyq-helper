import { openDB } from 'idb'
import type { IDBPDatabase } from 'idb'
import type { AppConfig } from '../types/config'
import type { UnknownQuestion, UserQuestionRecord } from '../types/question'
import type { RemoteQuestionCache } from '../types/remoteQuestion'
import { createRemoteQuestionCacheRepository } from '../features/remote-query/remoteQuestionCache'

/** 将本地数据库升级到当前结构，同时保留既有 store 和数据。 */
export function upgradeLocalStorageDatabase(db: IDBPDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    db.createObjectStore('config')
    db.createObjectStore('unknown_questions', { keyPath: 'id', autoIncrement: true })
    db.createObjectStore('user_questions', { keyPath: 'id', autoIncrement: true })
  }
  if (!db.objectStoreNames.contains('remote_question_cache')) {
    db.createObjectStore('remote_question_cache', { keyPath: 'id' })
  }
}

let databasePromise: Promise<IDBPDatabase> | null = null

/** 释放失效的数据库连接缓存，使后续操作能够重新建立连接。 */
function invalidateDatabaseConnection(connectionPromise: Promise<IDBPDatabase>): void {
  if (databasePromise === connectionPromise) databasePromise = null
}

/** 获取可复用的数据库连接，并在版本切换或连接终止后自动失效。 */
function getDatabase(): Promise<IDBPDatabase> {
  if (databasePromise) return databasePromise

  let database: IDBPDatabase | undefined
  const connectionPromise = openDB('xyq-helper', 2, {
    upgrade: upgradeLocalStorageDatabase,
    blocking() {
      invalidateDatabaseConnection(connectionPromise)
      database?.close()
    },
    terminated() {
      invalidateDatabaseConnection(connectionPromise)
    },
  })

  databasePromise = connectionPromise
  void connectionPromise.then(
    (openedDatabase) => {
      database = openedDatabase
      openedDatabase.addEventListener('close', () => {
        invalidateDatabaseConnection(connectionPromise)
      }, { once: true })
    },
    () => invalidateDatabaseConnection(connectionPromise),
  )
  return connectionPromise
}

/** 判断操作失败是否由 IndexedDB 连接正在关闭引起。 */
function isClosingConnectionError(error: unknown): boolean {
  return error instanceof DOMException
    && error.name === 'InvalidStateError'
    && error.message.toLowerCase().includes('clos')
}

/** 使用当前数据库连接执行操作，连接关闭竞态发生时自动重连并重试一次。 */
async function withDatabase<T>(operation: (database: IDBPDatabase) => Promise<T>): Promise<T> {
  const connectionPromise = getDatabase()
  const database = await connectionPromise

  try {
    return await operation(database)
  } catch (error) {
    if (!isClosingConnectionError(error)) throw error
    invalidateDatabaseConnection(connectionPromise)
    database.close()
    return await operation(await getDatabase())
  }
}

/** 保存应用配置。 */
export async function saveConfig(config: AppConfig): Promise<void> {
  await withDatabase(async db => await db.put('config', config, 'app'))
}

/** 读取应用配置，未保存时返回空值。 */
export async function loadConfig(): Promise<AppConfig | null> {
  return await withDatabase(async db => (await db.get('config', 'app')) ?? null)
}

/** 保存一条未识别题目。 */
export async function saveUnknownQuestion(question: UnknownQuestion): Promise<void> {
  await withDatabase(async db => await db.add('unknown_questions', question))
}

/** 列出全部未识别题目。 */
export async function listUnknownQuestions(): Promise<UnknownQuestion[]> {
  return await withDatabase(async db => await db.getAll('unknown_questions'))
}

/** 按分类和题目指纹读取远程成功缓存。 */
export async function getRemoteQuestionCache(
  categoryId: string,
  fingerprint: string,
): Promise<RemoteQuestionCache | undefined> {
  return await withDatabase(async db => (
    await createRemoteQuestionCacheRepository(db).get(categoryId, fingerprint)
  ))
}

/** 保存一条远程成功缓存。 */
export async function putRemoteQuestionCache(record: RemoteQuestionCache): Promise<void> {
  await withDatabase(async db => await createRemoteQuestionCacheRepository(db).put(record))
}

/** 清理指定分类的远程成功缓存。 */
export async function clearRemoteQuestionCacheByCategory(categoryId: string): Promise<void> {
  await withDatabase(async db => await createRemoteQuestionCacheRepository(db).clearCategory(categoryId))
}

/** 清理全部本地数据及远程成功缓存。 */
export async function clearAllLocalData(): Promise<void> {
  await withDatabase(async db => {
    await Promise.all([
      db.clear('config'),
      db.clear('unknown_questions'),
      db.clear('user_questions'),
      createRemoteQuestionCacheRepository(db).clearAll(),
    ])
  })
}

/** 清理全部远程成功缓存。 */
export async function clearAllRemoteQuestionCache(): Promise<void> {
  await withDatabase(async db => await createRemoteQuestionCacheRepository(db).clearAll())
}

/** 读取全部成功答案缓存，供题库维护页面审核和收录。 */
export async function listRemoteQuestionCaches(): Promise<RemoteQuestionCache[]> {
  return await withDatabase(async db => await db.getAll('remote_question_cache'))
}

/** 读取全部人工新增和修订题目。 */
export async function listUserQuestions(): Promise<UserQuestionRecord[]> {
  return await withDatabase(async db => await db.getAll('user_questions'))
}

/** 新增或更新一条人工题目，并返回数据库主键。 */
export async function putUserQuestion(question: UserQuestionRecord): Promise<number> {
  return await withDatabase(async db => await db.put('user_questions', question) as number)
}

/** 批量写入用户题库记录，在同一事务内完成远程题目沉淀。 */
export async function putUserQuestions(questions: UserQuestionRecord[]): Promise<void> {
  if (questions.length === 0) return
  await withDatabase(async db => {
    const transaction = db.transaction('user_questions', 'readwrite')
    for (const question of questions) await transaction.store.put(question)
    await transaction.done
  })
}

/** 删除一条人工题目或修订记录。 */
export async function deleteUserQuestion(id: number): Promise<void> {
  await withDatabase(async db => await db.delete('user_questions', id))
}

/** 以一次事务替换人工题库，供导入完整备份使用。 */
export async function replaceUserQuestions(questions: UserQuestionRecord[]): Promise<void> {
  await withDatabase(async db => {
    const transaction = db.transaction('user_questions', 'readwrite')
    await transaction.store.clear()
    for (const question of questions) await transaction.store.put(question)
    await transaction.done
  })
}
