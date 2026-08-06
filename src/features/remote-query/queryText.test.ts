import { describe, expect, it } from 'vitest'
import {
  cleanRemoteQueryText,
  createQuestionFingerprint,
  findSimilarQuestionEntry,
  selectFallbackKeyword,
} from './queryText'

const longQuestionText = '中国古代文学发展历史上被称为诗鬼并且留下许多脍炙人口著名诗篇传世作品的唐代诗人究竟是谁？'
const noisyLongQuestionText = longQuestionText.replace('留下', '留卞')

describe('远程查询文本', () => {
  it('清理换行、选项编号和 OCR 符号噪声，但保留题意', () => {
    expect(cleanRemoteQueryText(' 唐代诗人中，\n被称为“诗鬼”的是谁？ A.李白 '))
      .toBe('唐代诗人中，被称为“诗鬼”的是谁？')
  })

  it('相同标准化题干生成相同指纹', () => {
    expect(createQuestionFingerprint('谁被称为诗鬼？'))
      .toBe(createQuestionFingerprint('谁 被称为“诗鬼”'))
  })

  it('使用严格大于 0.95 的相似度复用题目记录', () => {
    const record = { normalizedQuestion: longQuestionText, value: 'cached-answer' }

    expect(findSimilarQuestionEntry(noisyLongQuestionText, [record])).toBe(record)
    expect(findSimilarQuestionEntry('完全不同的题目', [record])).toBeNull()
  })

  it('优先使用引号中的专有内容作为降级关键词', () => {
    expect(selectFallbackKeyword('唐代诗人中，被称为“诗鬼”的是谁？')).toBe('诗鬼')
  })

  it('无引号题干优先提取人名实体', () => {
    expect(selectFallbackKeyword('唐代诗人李白被后世称为什么？')).toBe('李白')
    expect(selectFallbackKeyword('明朝李时珍所著的药物学著作是什么？')).toBe('李时珍')
  })

  it('无引号题干可提取朝代实体', () => {
    expect(selectFallbackKeyword('唐朝的都城在今天的哪个城市？')).toBe('唐朝')
  })

  it('无引号题干可提取数字量词', () => {
    expect(selectFallbackKeyword('每轮抓鬼任务需要完成10次才能获得额外奖励吗？')).toBe('10次')
  })

  it('无引号长题干选择唯一的高信息窗口', () => {
    expect(selectFallbackKeyword('中国古代四大发明中最早用于航海定向的工具是什么？')).toBe('四大发明')
  })

  it('不会选择通用问句词', () => {
    expect(selectFallbackKeyword('以下哪个说法是正确的？')).toBeNull()
  })
})
