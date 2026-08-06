import { openDB } from 'idb'
import type { IDBPDatabase } from 'idb'
import type { AppConfig } from '../types/config'
import type { UnknownQuestion } from '../types/question'
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

const dbPromise = openDB('xyq-helper', 2, { upgrade: upgradeLocalStorageDatabase })

/** 保存应用配置。 */
export async function saveConfig(config: AppConfig): Promise<void> {
  const db = await dbPromise
  await db.put('config', config, 'app')
}

/** 读取应用配置，未保存时返回空值。 */
export async function loadConfig(): Promise<AppConfig | null> {
  const db = await dbPromise
  return (await db.get('config', 'app')) ?? null
}

/** 保存一条未识别题目。 */
export async function saveUnknownQuestion(question: UnknownQuestion): Promise<void> {
  const db = await dbPromise
  await db.add('unknown_questions', question)
}

/** 列出全部未识别题目。 */
export async function listUnknownQuestions(): Promise<UnknownQuestion[]> {
  const db = await dbPromise
  return await db.getAll('unknown_questions')
}

/** 按分类和题目指纹读取远程成功缓存。 */
export async function getRemoteQuestionCache(
  categoryId: string,
  fingerprint: string,
): Promise<RemoteQuestionCache | undefined> {
  const db = await dbPromise
  return await createRemoteQuestionCacheRepository(db).get(categoryId, fingerprint)
}

/** 保存一条远程成功缓存。 */
export async function putRemoteQuestionCache(record: RemoteQuestionCache): Promise<void> {
  const db = await dbPromise
  await createRemoteQuestionCacheRepository(db).put(record)
}

/** 清理指定分类的远程成功缓存。 */
export async function clearRemoteQuestionCacheByCategory(categoryId: string): Promise<void> {
  const db = await dbPromise
  await createRemoteQuestionCacheRepository(db).clearCategory(categoryId)
}

/** 清理全部本地数据及远程成功缓存。 */
export async function clearAllLocalData(): Promise<void> {
  const db = await dbPromise
  await Promise.all([
    db.clear('config'),
    db.clear('unknown_questions'),
    db.clear('user_questions'),
    createRemoteQuestionCacheRepository(db).clearAll(),
  ])
}

/** 清理全部远程成功缓存。 */
export async function clearAllRemoteQuestionCache(): Promise<void> {
  const db = await dbPromise
  await createRemoteQuestionCacheRepository(db).clearAll()
}