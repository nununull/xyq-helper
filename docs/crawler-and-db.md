# 175DT 爬虫与题库构建说明

## 当前状态

已实现三个脚本：

- `crawler/175dt-crawler.mjs`：抓取 175DT 分类导航，并输出标准 JSONL 题库文件。
- `scripts/merge-questions.mjs`：合并多个平台的 JSONL，按内容 hash 去重并合并来源。
- `scripts/build-index.mjs`：读取 JSONL，清洗去重，生成 `public/data/questions.json`、`public/data/trigram-index.json` 和 `public/data/version.json`。
- `scripts/build-db.mjs`：备用 SQLite 构建脚本，不作为默认分享版检索方案。

## 运行时使用方式

普通用户运行当前前端时不需要先执行爬虫、合并脚本或本地题库构建。用户在主控制台选择活动分类并开始连续识别后，运行时会先按“分类 ID + 标准化题目指纹”查询 IndexedDB 成功缓存；缓存未命中时直接调用 175DT 搜索接口。完整题干没有候选时只会再使用一个回退关键词查询一次。

远程结果返回的是答案文本，前端会根据当前 OCR 选项重新推导 A/B/C/D；成功结果写入 IndexedDB，刷新页面后可以继续复用。远程查询失败不会写入成功缓存：普通失败对当前题目冷却 10 秒，手动重试可绕过该冷却；HTTP 403/429 对当前分类冷却 60 秒。

由于前端静态页面与 `s.175dt.com` 跨源，正常使用远程查询需要用户在浏览器安装并启用允许该目标站请求的 CORS 扩展。未启用、网络中断或跨域请求被拦截时，界面会显示“可能是 CORS 或网络错误”。

本文后续命令继续保留，用于离线数据集维护、增量抓取、来源合并、JSON trigram 索引生成和 SQLite 备用产物构建。它们是维护工具和可选离线能力，不是普通用户启动应用的前置步骤，也不是当前生产运行时的默认查询链路。

## 重要限制

175DT 当前页面的完整题库没有直接出现在静态 HTML 中，搜索逻辑通过独立搜索接口完成。当前已确认可用接口：

```text
https://s.175dt.com/?id=<分类ID>&kw=<关键词>&c=10000
```

示例：

```text
https://s.175dt.com/?id=44&kw=隋朝&c=10000
```

接口返回结构：

```json
{"status":200,"hits":[{"q":"题干 HTML","a":"答案文本"}]}
```

因此当前链路已经具备：

- 分类发现。
- 标准 JSONL 消费。
- 题目清洗。
- 去重。
- SQLite 生成。
- FTS5 能力检测。
- 无 FTS5 时退回普通索引。

仍然缺少：

- 全量关键词种子列表。
- 分类与关键词组合的去重抓取策略。
- 多来源答案交叉校验。

## 使用命令

抓取分类并生成空 JSONL：

```powershell
npm run crawl:175dt
```

只抓指定分类和关键词：

```powershell
node crawler/175dt-crawler.mjs --ids 44 --kw 隋朝
```

抓多个分类和多个关键词：

```powershell
node crawler/175dt-crawler.mjs --ids 44,15,16 --kw 隋朝,李白,科举
```

从文件读取关键词，每行一个：

```powershell
node crawler/175dt-crawler.mjs --ids 44 --keywords-file data/keywords.txt
```

滚雪球抓取：

```powershell
node crawler/175dt-crawler.mjs --ids 44 --kw 隋朝 --expand true --rounds 3 --max-keywords-per-round 80
```

参数说明：

- `--expand true`：启用滚雪球模式。
- `--rounds 3`：最多扩展 3 轮。
- `--max-keywords-per-round 80`：每轮最多搜索 80 个新关键词。
- `--delay 300`：每次请求后的等待毫秒数，默认 300。

滚雪球流程：

```text
初始关键词
→ 调用 175DT 搜索接口
→ 写入新题并按题干 + 答案去重
→ 从新题题干和答案中提取 2-4 字中文关键词
→ 下一轮继续搜索
→ 直到达到轮数或没有新关键词
```

## 断点续跑

爬虫默认边抓边写。每抓到一条新题，会立即追加到 `questions.jsonl`；每完成一个 `分类ID + 关键词` 请求，会写入状态文件。

默认状态文件：

```text
data/raw/questions.jsonl.state.json
```

状态文件记录已经处理过的关键词组合：

```json
{"processedKeys":["44|隋朝"]}
```

因此脚本中途停止后，重新执行同样命令即可：

```powershell
node crawler/175dt-crawler.mjs --ids 44 --kw 隋朝 --expand true --rounds 3 --delay 1200
```

已写入的题目不会重复入库，已完成的关键词也不会重复请求。

如果需要强制重新请求同一批关键词，可以删除对应 `.state.json` 文件，或者指定新的状态文件：

```powershell
node crawler/175dt-crawler.mjs --ids 44 --kw 隋朝 --state data/raw/manual-rerun.state.json
```

如果需要把当前 JSONL 重新清洗排序，执行：

```powershell
npm run merge:questions
```

构建正式前端检索索引：

```powershell
npm run build:index
```

合并多个平台题库：

```powershell
node scripts/merge-questions.mjs --input data/import --output data/raw/questions.jsonl
```

也可以指定多个 JSONL 文件：

```powershell
node scripts/merge-questions.mjs --input data/import/175dt.jsonl,data/import/yzz.jsonl --output data/raw/questions.jsonl
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
{"question":"隋朝的“隋”字由多少笔画组成？","options":{},"answerText":"十一画","category":"金兜洞兕大王","subCategory":"金兜洞兕大王","source":"175dt"}
```

175DT 搜索接口返回的是答案文本，不是 A/B/C/D。前端匹配时会将 `answerText` 与 OCR 识别到的选项做相似度比较，再反推出答案字母。

## 后续更新流程

175DT 增量更新：

```powershell
node crawler/175dt-crawler.mjs --ids 44 --kw 隋朝 --expand true --rounds 3
npm run merge:questions
npm run build:index
```

多平台更新：

```powershell
node scripts/merge-questions.mjs --input data/import --output data/raw/questions.jsonl
npm run build:index
```

去重规则：

- `contentHash = 标准化题干 + 标准化答案文本`。
- 相同 `contentHash` 视为同一道题。
- 重复题不会丢弃来源，而是合并到 `sources` 数组。
- 多来源题会提高 `confidence`，最高为 1。

## 请求频率建议

当前脚本默认 `--delay 300`，也就是每次请求后等待 300ms。这个频率不保证不会触发站点风控，因为是否封 IP 取决于 175DT 的服务端策略、同 IP 请求量、时间段和站点负载。

建议：

- 日常抓取使用 `--delay 800` 到 `--delay 1500`。
- 滚雪球模式先限制 `--ids`，不要一上来全分类。
- `--max-keywords-per-round` 建议从 30 到 80 开始。
- `--rounds` 建议从 2 到 4 开始。
- 如果出现 403、429、连接超时或大量空结果，立刻停止，隔一段时间再跑。
- 不要并发请求，不要多开脚本。

保守示例：

```powershell
node crawler/175dt-crawler.mjs --ids 44 --kw 隋朝 --expand true --rounds 3 --max-keywords-per-round 50 --delay 1200
```

## JSON trigram 索引策略（可选离线能力）

构建链路可以生成 JSON + trigram 倒排索引，供离线数据维护或未来显式回退使用，不依赖浏览器端 SQLite FTS5。当前生产运行时默认采用“IndexedDB 成功缓存 → 175DT 远程查询”，不会强制下载这些 JSON 产物。

构建输出：

- `public/data/questions.json`：题目主体数据。
- `public/data/trigram-index.json`：三字片段到题目 ID 的倒排索引。
- `public/data/version.json`：题库版本、数量、hash 和检索模式。

可选离线检索流程：

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

下一步应准备高覆盖关键词种子。建议来源：

- 常见历史、人文、地理、游戏名词。
- 已知题库题干中的高频词。
- 用户本地未知题回流关键词。
- 其他题库站点的题干关键词。
