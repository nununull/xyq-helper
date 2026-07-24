# 175DT 爬虫与题库构建说明

## 当前状态

已实现三个脚本：

- `crawler/175dt-crawler.mjs`：抓取 175DT 分类导航，并输出标准 JSONL 题库文件。
- `scripts/build-index.mjs`：读取 JSONL，清洗去重，生成 `public/data/questions.json`、`public/data/trigram-index.json` 和 `public/data/version.json`。
- `scripts/build-db.mjs`：备用 SQLite 构建脚本，不作为默认分享版检索方案。

## 重要限制

175DT 当前页面的完整题库没有直接出现在静态 HTML 中，搜索逻辑被编译在 wasm 内部。当前脚本可以稳定抓取分类结构，但无法从静态页面直接批量导出完整题库。

因此当前链路已经具备：

- 分类发现。
- 标准 JSONL 消费。
- 题目清洗。
- 去重。
- SQLite 生成。
- FTS5 能力检测。
- 无 FTS5 时退回普通索引。

但还缺少：

- 175DT 内部搜索接口的稳定调用方式。
- 或合法的数据导出来源。
- 或人工整理后的 JSONL 输入。

## 使用命令

抓取分类并生成空 JSONL：

```powershell
npm run crawl:175dt
```

构建正式前端检索索引：

```powershell
npm run build:index
```

构建备用 SQLite：

```powershell
npm run build:db
```

指定输入输出：

```powershell
node scripts/build-index.mjs --input data/raw/questions.jsonl --questions public/data/questions.json --index public/data/trigram-index.json --version public/data/version.json
```

## JSONL 格式

每行一条题目：

```json
{"question":"下列关于唐朝诗人李白的说法错误的是？","options":{"A":"他出生于碎叶城","B":"他号称诗仙","C":"他是浪漫主义诗人","D":"他与杜甫并称李杜"},"answer":"A","category":"科举","subCategory":"乡试","source":"175dt"}
```

## JSON trigram 索引策略

正式分享版使用 JSON + trigram 倒排索引，不依赖浏览器端 SQLite FTS5。

构建输出：

- `public/data/questions.json`：题目主体数据。
- `public/data/trigram-index.json`：三字片段到题目 ID 的倒排索引。
- `public/data/version.json`：题库版本、数量、hash 和检索模式。

运行时流程：

```text
OCR 题干
→ 标准化文本
→ 生成 trigram
→ 倒排索引召回候选题
→ Dice 相似度排序
→ 选项二次校验
→ 输出答案
```

## SQLite 备用构建策略

优先级：

1. 尝试创建 `fts5 + trigram` 虚表。
2. 如果 trigram 不可用，尝试默认 FTS5。
3. 如果当前 SQLite wasm 不含 FTS5，创建普通表和普通索引。

SQLite 构建结果会在 `version.json` 中记录 `searchMode`：

- `fts5-trigram`
- `fts5-default`
- `table`
- `json-trigram`

## 后续建议

下一步应使用浏览器网络面板或自动化浏览器捕获 175DT 搜索时的真实请求。如果能得到稳定接口，再把接口调用补进 `crawler/175dt-crawler.mjs`，直接生成完整 `questions.jsonl`。
