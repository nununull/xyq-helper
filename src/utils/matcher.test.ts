import { describe, expect, it } from 'vitest'
import type { ParsedQuestion, QuestionRecord } from '../types/question'
import { matchQuestion } from './matcher'

const parsed: ParsedQuestion = {
  questionText: '被称为诗鬼的唐代诗人是谁？',
  normalizedQuestion: '被称为诗鬼的唐代诗人是谁',
  options: { A: '李白', B: '杜甫', C: '李贺', D: '白居易' },
  normalizedOptions: 'A李白B杜甫C李贺D白居易',
  rawText: '',
}

const officialQuestion: QuestionRecord = {
  id: 1,
  question: '被称为“诗鬼”的唐代诗人是谁？',
  normalizedQuestion: '被称为诗鬼的唐代诗人是谁',
  options: { A: '', B: '', C: '', D: '' },
  normalizedOptions: 'ABCD',
  answerText: '李贺',
  category: '网易官方题库',
  source: 'netease',
}

describe('matchQuestion', () => {
  it('官方题库没有历史选项时按题干评分并映射当前选项', () => {
    expect(matchQuestion(parsed, [officialQuestion], 0.82)).toMatchObject({
      answer: 'C',
      answerText: '李贺',
      source: 'netease',
      resultSource: 'local',
      confidence: 1,
    })
  })
})
