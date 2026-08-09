import type { UserQuestionRecord } from '../../types/question'
import type { RemoteQuestionCandidate } from '../../types/remoteQuestion'
import { normalizeQuestionText } from '../../utils/normalizeText'
import { sanitizeRemoteAnswer, sanitizeRemoteText } from '../../utils/sanitizeRemoteText'

/** 将远程候选转换为需要新增或更新的用户题库记录。 */
export function createRemoteQuestionRecords(
  existingRecords: UserQuestionRecord[],
  category: string,
  candidates: RemoteQuestionCandidate[],
): UserQuestionRecord[] {
  const existingByQuestion = new Map(
    existingRecords.map((item) => [normalizeQuestionText(item.question), item]),
  )
  const changedByQuestion = new Map<string, UserQuestionRecord>()
  const timestamp = new Date().toISOString()

  for (const candidate of candidates) {
    if (candidate.source !== '175dt') continue
    const question = sanitizeRemoteText(candidate.question)
    const answerText = sanitizeRemoteAnswer(candidate.answerText)
    const key = normalizeQuestionText(question)
    if (!key || !answerText) continue

    const existing = existingByQuestion.get(key)
    if (existing?.source === 'manual') continue
    if (existing?.answerText === answerText && existing.category === category) continue

    const record: UserQuestionRecord = {
      ...existing,
      question,
      options: existing?.options ?? { A: '', B: '', C: '', D: '' },
      answer: existing?.answer,
      answerText,
      category,
      source: '175dt',
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      revision: (existing?.revision ?? 0) + 1,
    }
    existingByQuestion.set(key, record)
    changedByQuestion.set(key, record)
  }

  return [...changedByQuestion.values()]
}
