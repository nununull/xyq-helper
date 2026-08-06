import { describe, expect, it } from 'vitest'
import {
  cleanRemoteQueryText,
  createQuestionFingerprint,
  selectFallbackKeyword,
} from './queryText'

describe('远程查询文本', () => {
  it('清理换行、选项编号和 OCR 符号噪声，但保留题意', () => {
    expect(cleanRemoteQueryText(' 唐代诗人中，\n被称为“诗鬼”的是谁？ A.李白 '))
      .toBe('唐代诗人中，被称为“诗鬼”的是谁？')
  })

  it('相同标准化题干生成相同指纹', () => {
    expect(createQuestionFingerprint('谁被称为诗鬼？'))
      .toBe(createQuestionFingerprint('谁 被称为“诗鬼”'))
  })

  it('优先使用引号中的专有内容作为降级关键词', () => {
    expect(selectFallbackKeyword('唐代诗人中，被称为“诗鬼”的是谁？')).toBe('诗鬼')
  })

  it('不会选择通用问句词', () => {
    expect(selectFallbackKeyword('以下哪个说法是正确的？')).toBeNull()
  })
})
