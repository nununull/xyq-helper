import type { OCRResult } from '../types/ocr'
import type { AnswerOptionKey, ParsedQuestion } from '../types/question'
import { normalizeQuestionText } from './normalizeText'

const optionPattern = /(?:^|\s)([ABCD])[\.\。:：、\s]+([^ABCD]+)/gi

/**
 * 从 OCR 原文中抽取题干和 A-D 选项。
 */
export function parseQuestion(result: OCRResult): ParsedQuestion {
  const rawText = `${result.question.text}\n${result.options.text}`.trim()
  const options: Partial<Record<AnswerOptionKey, string>> = {}
  let optionSource = result.options.text.replace(/\n+/g, ' ')

  for (const match of optionSource.matchAll(optionPattern)) {
    const key = match[1].toUpperCase() as AnswerOptionKey
    options[key] = match[2].trim()
  }

  // 如果选项区域识别失败，尝试从完整文本里兜底解析。
  if (Object.keys(options).length === 0) {
    optionSource = rawText.replace(/\n+/g, ' ')
    for (const match of optionSource.matchAll(optionPattern)) {
      const key = match[1].toUpperCase() as AnswerOptionKey
      options[key] = match[2].trim()
    }
  }

  // 游戏只按颜色和行序显示选项时，使用纵向顺序补全 A-D 语义。
  if (Object.keys(options).length === 0) {
    const orderedLines = result.options.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    if (orderedLines.length >= 2 && orderedLines.length <= 4) {
      const keys: AnswerOptionKey[] = ['A', 'B', 'C', 'D']
      orderedLines.forEach((line, index) => {
        options[keys[index]] = line
      })
    }
  }

  const normalizedOptions = Object.entries(options)
    .map(([key, value]) => `${key}${normalizeQuestionText(value ?? '')}`)
    .join('')

  return {
    questionText: result.question.text.trim(),
    options,
    normalizedQuestion: normalizeQuestionText(result.question.text),
    normalizedOptions,
    rawText,
  }
}
