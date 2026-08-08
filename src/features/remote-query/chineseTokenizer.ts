let tokenizerPromise: Promise<(text: string) => string[]> | null = null

/**
 * 延迟加载结巴 WASM 分词器，避免本地题库命中时下载额外词典。
 * 初始化失败时退回浏览器原生分词，保证远程查询仍可继续工作。
 */
async function loadTokenizer(): Promise<(text: string) => string[]> {
  if (!tokenizerPromise) {
    tokenizerPromise = import('jieba-wasm/web')
      .then(async (jieba) => {
        await jieba.default()
        return (text: string) => jieba.cut(text, true)
      })
      .catch(() => createNativeTokenizer())
  }
  return tokenizerPromise
}

/** 使用 Intl.Segmenter 创建无需词典下载的降级分词器。 */
function createNativeTokenizer(): (text: string) => string[] {
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
  return (text) => [...segmenter.segment(text)]
    .filter((item) => item.isWordLike)
    .map((item) => item.segment)
}

/** 将题干切分为适合构造连续搜索短语的自然语言词元。 */
export async function tokenizeChineseQuery(text: string): Promise<string[]> {
  const tokenizer = await loadTokenizer()
  return tokenizer(text)
    .map((token) => token.trim())
    .filter(Boolean)
}
