import { describe, expect, it } from 'vitest'
import {
  extractChunkAssetPaths,
  extractNeteaseQuestions,
} from './lib/netease-question-extractor.mjs'

describe('netease-question-extractor', () => {
  it('从 webpack 运行时代码中还原异步分包地址', () => {
    const runtime = 't.u=function(e){return"static/js/"+({148:"pagee",177:"home"}[e]||e)+"."+{0:"101edabc",148:"8d25dbdb",177:"995afc93"}[e]+".js"}'

    expect(extractChunkAssetPaths(runtime)).toEqual([
      'static/js/0.101edabc.js',
      'static/js/home.995afc93.js',
      'static/js/pagee.8d25dbdb.js',
    ])
  })

  it('提取题目答案并处理转义字符和重复数据', () => {
    const source = 'const a=[{Id:"1",Q:"谁被称为\\"诗仙\\"？",A:"李白"},{Id:"2",Q:"谁被称为\\"诗仙\\"？",A:"李白"},{Id:"3",Q:"无答案",X:"忽略"}]'

    expect(extractNeteaseQuestions(source, 'https://example.com/chunk.js')).toEqual([
      expect.objectContaining({
        question: '谁被称为"诗仙"？',
        answerText: '李白',
        source: 'netease',
      }),
    ])
  })
})
