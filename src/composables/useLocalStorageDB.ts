import { openDB } from 'idb'
import type { AppConfig } from '../types/config'
import type { UnknownQuestion } from '../types/question'

const dbPromise = openDB('xyq-helper', 1, {
  upgrade(db) {
    db.createObjectStore('config')
    db.createObjectStore('unknown_questions', { keyPath: 'id', autoIncrement: true })
    db.createObjectStore('user_questions', { keyPath: 'id', autoIncrement: true })
  },
})

export async function saveConfig(config: AppConfig): Promise<void> {
  const db = await dbPromise
  await db.put('config', config, 'app')
}

export async function loadConfig(): Promise<AppConfig | null> {
  const db = await dbPromise
  return (await db.get('config', 'app')) ?? null
}

export async function saveUnknownQuestion(question: UnknownQuestion): Promise<void> {
  const db = await dbPromise
  await db.add('unknown_questions', question)
}

export async function listUnknownQuestions(): Promise<UnknownQuestion[]> {
  const db = await dbPromise
  return await db.getAll('unknown_questions')
}

export async function clearAllLocalData(): Promise<void> {
  const db = await dbPromise
  await Promise.all([
    db.clear('config'),
    db.clear('unknown_questions'),
    db.clear('user_questions'),
  ])
}
