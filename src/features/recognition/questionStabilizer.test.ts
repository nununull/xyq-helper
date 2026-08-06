import { describe, expect, it } from 'vitest'
import { createQuestionStabilizer } from './questionStabilizer'

const parsed = (text: string) => ({
  questionText: text,
  normalizedQuestion: text,
  options: {},
  normalizedOptions: '',
  rawText: text,
})

describe('题目稳定器', () => {
  it('明确标记首帧待稳定题目', () => {
    const stabilizer = createQuestionStabilizer()

    expect(stabilizer.push(parsed('被称为诗鬼的诗人是谁'))).toMatchObject({
      kind: 'firstFrame',
      question: { questionText: '被称为诗鬼的诗人是谁' },
    })
  })

  it('第二帧相似度达到 0.9 时放行当前题目', () => {
    const stabilizer = createQuestionStabilizer(0.9)
    const firstQuestion = 'abcdefghijklmnopqrstu'
    const currentQuestion = 'abcdefghijxlmnopqrstu'

    stabilizer.push(parsed(firstQuestion))

    const result = stabilizer.push(parsed(currentQuestion))
    expect(result).toMatchObject({
      kind: 'stable',
      question: { questionText: currentQuestion },
      previousQuestion: { questionText: firstQuestion },
    })
    expect(result.kind === 'firstFrame' ? null : result.similarity).toBeGreaterThanOrEqual(0.9)
  })

  it('明确标记明显换题并将其作为新的待配对题目', () => {
    const stabilizer = createQuestionStabilizer(0.9)

    stabilizer.push(parsed('被称为诗鬼的诗人是谁'))
    expect(stabilizer.push(parsed('唐朝诗人李白被称为什么'))).toMatchObject({
      kind: 'switched',
      question: { questionText: '唐朝诗人李白被称为什么' },
      previousQuestion: { questionText: '被称为诗鬼的诗人是谁' },
    })
    expect(stabilizer.push(parsed('唐朝诗人李白被称为什么'))).toMatchObject({
      kind: 'stable',
      question: { questionText: '唐朝诗人李白被称为什么' },
    })
  })

  it('重置后会清除历史题目', () => {
    const stabilizer = createQuestionStabilizer()

    stabilizer.push(parsed('被称为诗鬼的诗人是谁'))
    stabilizer.reset()

    expect(stabilizer.push(parsed('被称为诗鬼的诗人是谁')).kind).toBe('firstFrame')
  })
})
