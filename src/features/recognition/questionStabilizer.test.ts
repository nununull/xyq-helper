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
  it('首帧题目不会放行', () => {
    const stabilizer = createQuestionStabilizer()

    expect(stabilizer.push(parsed('被称为诗鬼的诗人是谁'))).toBeNull()
  })

  it('第二帧相似度达到 0.9 时放行当前题目', () => {
    const stabilizer = createQuestionStabilizer(0.9)
    const firstQuestion = 'abcdefghijklmnopqrstu'
    const currentQuestion = 'abcdefghijxlmnopqrstu'

    stabilizer.push(parsed(firstQuestion))

    expect(stabilizer.push(parsed(currentQuestion))?.questionText).toBe(currentQuestion)
  })

  it('不相关题目会作为新的待配对题目', () => {
    const stabilizer = createQuestionStabilizer(0.9)

    stabilizer.push(parsed('被称为诗鬼的诗人是谁'))
    expect(stabilizer.push(parsed('唐朝诗人李白被称为什么'))).toBeNull()
    expect(stabilizer.push(parsed('唐朝诗人李白被称为什么'))?.questionText).toBe('唐朝诗人李白被称为什么')
  })

  it('重置后会清除历史题目', () => {
    const stabilizer = createQuestionStabilizer()

    stabilizer.push(parsed('被称为诗鬼的诗人是谁'))
    stabilizer.reset()

    expect(stabilizer.push(parsed('被称为诗鬼的诗人是谁'))).toBeNull()
  })
})