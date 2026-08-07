import { describe, expect, it } from 'vitest'
import { rankRemoteCandidates } from '../features/remote-query/remoteCandidateMatcher'
import { parseQuestion } from './parseQuestion'

describe('OCR 题目解析', () => {
  it('选项没有字母标记时按纵向行序映射为 A 到 D', () => {
    const parsed = parseQuestion({
      question: { text: '唐 卡 是 《〈) 富有 民族 特色 的 卷轴 画', confidence: 0.87 },
      options: { text: '藏族\n汉族\n满族\n维吾尔 族\n', confidence: 0.92 },
      durationMs: 100,
    })

    expect(parsed.options).toEqual({
      A: '藏族',
      B: '汉族',
      C: '满族',
      D: '维吾尔 族',
    })

    const decision = rankRemoteCandidates(parsed, [{
      question: '唐卡是（）富有民族特色的卷轴画',
      answerText: '藏族',
      source: '175dt',
    }], 0.87)
    expect(decision.best?.answer).toBe('A')
  })
})
