import { describe, expect, it } from 'vitest'
import { rankRemoteCandidates } from './remoteCandidateMatcher'

const parsed = {
  questionText: '被称为诗鬼的唐代诗人是谁？',
  normalizedQuestion: '被称为诗鬼的唐代诗人是谁',
  options: { A: '李白', B: '杜甫', C: '李贺', D: '白居易' },
  normalizedOptions: 'A李白B杜甫C李贺D白居易',
  rawText: '',
}

describe('远程候选排序', () => {
  it('选择题干最接近且答案能对应选项的候选题', () => {
    const decision = rankRemoteCandidates(parsed, [
      { question: '被称为诗圣的诗人是谁？', answerText: '杜甫', source: '175dt' },
      { question: '被称为诗鬼的唐代诗人是谁？', answerText: '李贺', source: '175dt' },
    ], 0.9)

    expect(decision.best?.answer).toBe('C')
    expect(decision.kind).toBe('confident')
  })

  it('答案无法对应选项时保留答案文本但不猜字母', () => {
    const decision = rankRemoteCandidates(parsed, [
      { question: parsed.questionText, answerText: '韩愈', source: '175dt' },
    ], 0.9)

    expect(decision.best?.answer).toBeNull()
    expect(decision.best?.answerText).toBe('韩愈')
  })

  it('前两名分差小于 0.05 时标记歧义', () => {
    const decision = rankRemoteCandidates(parsed, [
      { question: parsed.questionText, answerText: '李贺', source: '175dt' },
      { question: parsed.questionText, answerText: '杜甫', source: '175dt' },
    ], 0.9)

    expect(decision.kind).toBe('ambiguous')
  })
})
