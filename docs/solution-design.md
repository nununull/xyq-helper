# 梦幻西游答题助手方案设计文档

## 1. 背景与目标

本项目用于构建一个梦幻西游答题辅助工具。工具运行在浏览器中，基于用户授权的屏幕捕获、前端 OCR、IndexedDB 成功缓存和 175DT 远程查询完成题目识别与答案提示。

项目目标：

- 使用 Vue3、TypeScript、Vite 构建纯前端应用。
- 不接入 LLM，不依赖服务端实时推理。
- 用户先选择活动分类；同一分类下优先复用 IndexedDB 成功缓存，缓存未命中时再查询远程题库。
- 本地 JSON trigram 索引和 SQLite 构建链路继续保留，作为离线题库维护与后续可选回退能力，不是当前默认运行时依赖。
- 不注入游戏进程，不 Hook 内存，不模拟键鼠输入。
- 答案提示仅显示在浏览器识别窗口内，由用户自行回到游戏窗口操作。

## 2. 产品边界

### 2.1 当前版本边界

当前方案是纯前端浏览器应用。浏览器通过 `getDisplayMedia` 获取用户授权的屏幕或窗口画面，在页面内展示识别预览和答案提示。

答案浮层是浏览器页面内的 UI 组件，只覆盖浏览器中的识别窗口或预览区域，不覆盖 Windows 系统中的梦幻西游客户端窗口。

### 2.2 明确不做

- 不做系统级透明置顶窗口。
- 不自动操作游戏。
- 不读取游戏进程、内存、网络包或游戏本地数据。
- 不上传用户截图；缓存未命中时会把清洗后的 OCR 题干作为查询参数发送到 175DT，页面不采集行为数据。
- 不承诺浏览器最小化后仍可稳定高频识别。

### 2.3 后续可选增强

如果未来必须实现真正覆盖游戏客户端窗口的系统级浮层，应另开桌面增强版本，使用 Tauri 或 Electron 实现透明置顶窗口。该能力不属于当前纯前端方案。

## 3. 总体架构

```text
Vue3 SPA
├─ 设置向导
│  ├─ 题干区域框选
│  └─ 选项区域框选
├─ 捕获模块
│  ├─ getDisplayMedia
│  ├─ Canvas 抽帧
│  ├─ 区域裁剪
│  └─ 帧变化检测
├─ 图像预处理模块
│  ├─ 灰度化
│  ├─ 二值化
│  └─ 放大与降噪
├─ OCR 模块
│  ├─ Tesseract.js
│  ├─ Web Worker
│  └─ chi_sim 中文语言包
├─ 实时题库模块
│  ├─ 活动分类选择
│  ├─ IndexedDB 成功缓存
│  ├─ 175DT 主查询与一次关键词回退
│  └─ 10 秒题目冷却 / 60 秒分类限流冷却
├─ 匹配模块
│  ├─ OCR 文本清洗
│  ├─ 远程候选相似度排序
│  ├─ 答案文本到当前选项字母的反推
│  └─ 置信度计算
├─ 可选离线构建模块
│  ├─ JSONL 清洗与合并
│  ├─ questions.json + trigram-index.json
│  └─ SQLite / FTS5 备用构建
└─ UI 模块
   ├─ 主控制台
   ├─ 浏览器内答案浮层
   ├─ 未知题目管理
   └─ 设置面板
```

## 4. 技术选型

| 模块 | 选型 | 说明 |
|---|---|---|
| 前端框架 | Vue3 | 使用 Composition API 和 `<script setup>` |
| 开发语言 | TypeScript | 开启 strict 模式，保证数据结构清晰 |
| 构建工具 | Vite | 开发启动快，静态部署简单 |
| 状态管理 | Pinia | 管理捕获、OCR、题库、匹配和配置状态 |
| 屏幕捕获 | `getDisplayMedia` | 浏览器原生能力，必须由用户授权 |
| 图像处理 | Canvas 2D API | 完成抽帧、裁剪和预处理 |
| OCR | Tesseract.js | 纯前端 OCR，使用中文简体语言包 |
| 运行时题库 | 175DT 搜索接口 | 按用户选择的活动分类查询候选题，答案以文本形式返回 |
| 本地缓存 | IndexedDB + idb | 持久化配置、未知题和按“分类 + 题目指纹”保存的远程成功结果 |
| 可选离线题库 | JSON trigram / SQLite | 构建脚本继续可用，但当前生产运行时不强制下载或初始化本地题库 |
| 部署方式 | 静态托管 | 可部署到 Cloudflare Pages、Vercel 或普通静态服务器 |

## 5. 核心模块设计

### 5.1 设置向导模块

设置向导负责完成首次使用所需的基础配置。

主要能力：

- 框选题干区域。
- 框选选项区域。
- 每完成一步就把普通配置对象保存到 IndexedDB，避免响应式代理进入浏览器存储。
- 两个区域齐备后进入主控制台；屏幕/窗口授权在用户点击“开始连续识别”时进行。

配置数据结构：

```ts
export interface CaptureRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface CaptureConfig {
  questionRegion: CaptureRegion | null
  optionsRegion: CaptureRegion | null
  devicePixelRatio: number
  captureFps: number
}
```

设计要求：

- 区域坐标必须记录当时的 `devicePixelRatio`，避免 Windows 缩放导致裁剪错位。
- 当前向导按“准备 → 题干 → 选项”推进；两个区域未齐备时不会进入主控制台。
- 当前设置面板没有重新框选入口；需要重新配置时应清理本地配置后重新进入向导。

### 5.2 屏幕捕获模块

屏幕捕获模块封装 `getDisplayMedia` 和 Canvas 抽帧逻辑。

输入：

- 用户授权的视频流。
- 用户配置的题干区域和选项区域。
- 抽帧频率。

输出：

```ts
export interface CaptureFrame {
  questionImage: ImageData
  optionsImage: ImageData
  capturedAt: number
  frameHash: string
}
```

处理规则：

- 用户拒绝授权时给出明确错误提示。
- 屏幕流停止时自动进入暂停状态。
- 相邻帧内容一致时跳过 OCR。
- 默认抽帧频率为 1-2 fps，不追求高频实时。

### 5.3 图像预处理模块

图像预处理用于提升 OCR 稳定性。

MVP 阶段只实现必要能力：

- 灰度化。
- 2 倍放大。
- 简单阈值二值化。

后续增强：

- OTSU 自动阈值。
- 对比度增强。
- 背景降噪。
- 针对不同游戏字体的预设参数。

预处理函数接口：

```ts
export interface PreprocessOptions {
  grayscale: boolean
  scale: number
  binarize: boolean
  threshold: number
}

export function preprocessImage(
  image: ImageData,
  options: PreprocessOptions,
): ImageData
```

### 5.4 OCR 模块

OCR 模块负责初始化和复用 Tesseract Worker。

输出结构：

```ts
export interface OCRTextBlock {
  text: string
  confidence: number
}

export interface OCRResult {
  question: OCRTextBlock
  options: OCRTextBlock
  durationMs: number
}
```

设计要求：

- Worker 初始化后长驻复用。
- 不在每次识别时重复创建和销毁 Worker。
- OCR 失败时返回结构化错误，不让 UI 卡死。
- 低置信度结果进入人工确认或未知题流程。

### 5.5 OCR 文本解析模块

该模块将 OCR 原始文本转换为结构化题目。

输出结构：

```ts
export type AnswerOptionKey = 'A' | 'B' | 'C' | 'D'

export interface ParsedQuestion {
  questionText: string
  options: Partial<Record<AnswerOptionKey, string>>
  normalizedQuestion: string
  normalizedOptions: string
}
```

解析规则：

- 清理空格、换行、异常标点和重复字符。
- 尝试识别 `A.`、`B.`、`C.`、`D.` 形式的选项。
- 保留原始 OCR 文本用于排错。
- 生成标准化字段，用于容错匹配。

### 5.6 运行时题库与缓存模块

当前默认链路是“缓存优先、未命中远程查询”。用户必须先选择活动分类；当前实现提供“金兜洞兕大王”（分类 ID `44`）。控制器使用“分类 ID + 标准化题目指纹”读取 IndexedDB，仅保存已经成功匹配的远程结果，不缓存失败响应。

缓存记录保存识别题干、远程匹配题干、答案文本、来源、匹配置信度、创建时间、最近使用时间和命中次数。缓存命中后仍使用本帧 OCR 选项重新把答案文本映射为 A/B/C/D，因此选项顺序变化不会复用旧字母。设置面板支持清理当前分类或全部远程成功缓存。

缓存未命中时，请求 `https://s.175dt.com/?id=<分类ID>&kw=<题干>&c=10000`。完整题干返回空候选时，控制器最多再选取一个关键词查询一次；不会递归或无限回退。候选经题干相似度、选项答案文本和 OCR 置信度综合排序，可信或低置信度但可用的结果写入缓存。

175DT 接口属于跨源资源。静态页面部署后，用户浏览器需要安装并启用允许该目标站跨域请求的 CORS 扩展；扩展应只授予必要站点范围。跨域或网络失败时界面显示“可能是 CORS 或网络错误”。HTTP 403/429 会暂停当前分类 60 秒，其他查询失败会让当前题目冷却 10 秒；“手动重试”清除当前题目冷却，但不绕过分类限流冷却。

本地 JSON trigram 索引仍作为可选的离线构建/回退能力保留，不是当前生产运行时的强制依赖。其题目结构如下：

题目 JSON 结构：

```ts
export interface QuestionIndexRecord {
  id: number
  question: string
  normalizedQuestion: string
  options: Record<'A' | 'B' | 'C' | 'D', string>
  normalizedOptions: string
  answer: 'A' | 'B' | 'C' | 'D'
  category: string
  subCategory: string
  tags: string[]
  source: string
  confidence: number
  occurrenceCount: number
  questionHash: string
}
```

倒排索引结构：

```ts
export type TrigramIndex = Record<string, number[]>
```

分类表：

```sql
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);
```

用户本地补充题表：

```sql
CREATE TABLE user_questions (
  id INTEGER PRIMARY KEY,
  question TEXT NOT NULL,
  normalized_question TEXT NOT NULL,
  options_json TEXT,
  answer TEXT NOT NULL,
  category TEXT,
  source TEXT DEFAULT 'manual',
  question_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

未知题表：

```sql
CREATE TABLE unknown_questions (
  id INTEGER PRIMARY KEY,
  question TEXT NOT NULL,
  options_json TEXT,
  ocr_confidence REAL,
  category TEXT,
  screenshot_hash TEXT,
  created_at TEXT NOT NULL,
  status TEXT DEFAULT 'pending'
);
```

离线能力约束：

- `questions.json` 和 `trigram-index.json` 仍由构建脚本生成，供离线数据维护或未来显式回退使用。
- SQLite/FTS5 继续作为备用构建路线；两条离线链路都不能替代当前远程接口的运行时错误提示和冷却策略。
- 用户手动补充题和未知题的本地表结构继续保留，但当前实时答案链路只读写远程成功缓存。

### 5.7 匹配模块

当前运行时匹配流程：

```text
OCR 结果
→ 文本清洗
→ 结构化题干和选项
→ 标准化题干
→ 按分类和题目指纹查询 IndexedDB
→ 缓存未命中时查询远程题库（空结果时仅一次关键词回退）
→ 远程候选排序
→ 答案文本与当前选项相似度映射
→ 综合置信度计算
→ 输出答案并缓存成功结果，或进入等待重试状态
```

输出结构：

```ts
export interface MatchResult {
  questionId: number | string
  answer: AnswerOptionKey | null
  answerText?: string
  confidence: number
  matchedQuestion: string
  source: string
  resultSource?: 'local' | 'cache' | 'remote'
  durationMs?: number
  warning?: string
  candidates: MatchCandidate[]
}
```

置信度组成：

- 题干匹配分。
- 选项匹配分。
- OCR 平均置信度。
- 活动分类隔离。

处理规则：

- 置信度低于阈值时不显示强答案。
- 相似题歧义时不强提示，并进入 10 秒失败冷却。
- 答案文本与当前选项无法可靠对应时可保留答案文本，但答案字母为 `null`。

### 5.8 浏览器内答案浮层

答案浮层显示在浏览器识别窗口内部，用于突出当前推荐答案。

状态结构：

```ts
export interface AnswerOverlayState {
  visible: boolean
  answer: AnswerOptionKey | null
  confidence: number
  position: {
    x: number
    y: number
  }
  autoHideMs: number
}
```

设计要求：

- 浮层覆盖在浏览器预览区域或识别区域上。
- 不覆盖 Windows 系统中的游戏客户端窗口。
- 不模拟任何用户输入。
- 可配置透明度、字号、显示时长。
- 默认 10 秒后自动隐藏。

## 6. 界面设计

### 6.1 首次设置向导

页面内容：

- 当前步骤指示。
- 题干区域框选入口。
- 覆盖页面的拖拽框选层和取消按钮。
- 题干区域完成后自动进入选项区域；选项区域保存后自动进入主控制台。

### 6.2 主控制台

布局采用三栏结构。

左栏：

- 活动分类单选列表。
- 未选择分类时禁用“开始连续识别”；切换分类会停止捕获、清空旧上下文并持久化新选择。

中栏：

- 当前截图预览。
- OCR 识别文本。
- 结构化题干和选项。
- 推荐答案高亮。
- 匹配到的题库原题。

右栏：

- 连续识别阶段及提示文本。
- 答案来源（`cache` / `remote`）和本次总耗时。
- CORS、网络、限流、超时或匹配失败提示。
- 远程成功缓存清理入口。
- 未知题数量入口。

### 6.3 未知题目管理

当前界面只展示 IndexedDB 中未知题目的数量、题干和 OCR 置信度。人工选答案、忽略、导出和回写仍属于后续能力，尚未接入当前主控制台。

### 6.4 设置面板

配置项：

- 捕获频率。
- OCR 二值化阈值。
- 最小置信度。
- 当前分类缓存清理（未选择分类时禁用）。
- 全部远程成功缓存清理。

## 7. 核心流程

### 7.1 首次启动流程

```text
打开工具
→ 检查 IndexedDB 配置
→ 无配置则进入设置向导
→ 框选题干区域
→ 框选选项区域
→ 进入主控制台
→ 选择活动分类
→ 用户点击开始并授权屏幕捕获
→ 初始化或复用 OCR Worker
```

### 7.2 稳定题目查询流程

```text
抽取当前视频帧
→ 裁剪题干和选项区域
→ 图像预处理
→ OCR 识别
→ 文本结构化
→ 连续两帧确认题目稳定
→ 按活动分类和题目指纹查询 IndexedDB
→ 命中：以缓存答案文本重新推导当前选项字母并展示
→ 未命中：以完整题干查询 175DT
→ 空结果：选择一个回退关键词再查询一次
→ 候选排序、答案文本映射并展示
→ 成功结果写入 IndexedDB；失败进入冷却并暴露手动重试
```

### 7.3 连续识别流程

```text
用户开启连续识别
→ 按配置频率抽帧
→ 计算帧 hash
→ 与上一帧一致则跳过
→ 新帧串行执行 OCR 和稳定题判断
→ 相同稳定题只复用当前结果/缓存，不重复远程请求
→ 新稳定题会中止旧题在途请求，再执行查询流程
→ 等待下一轮
```

用户点击“停止”、主动结束屏幕共享、切换分类或隐藏页面时，连续识别立即停止，并中止在途远程请求；迟到的 OCR 或远程结果不得更新 UI。

### 7.4 可选离线题库更新流程

```text
按维护需求运行 175DT 爬虫或导入其他 JSONL
→ 合并、清洗并按内容 hash 去重
→ 生成 questions.json、trigram-index.json 和 version.json
→ 或生成备用 SQLite / FTS5 数据库
→ 作为离线数据产物归档；默认实时页面不会强制加载
```

## 8. 性能目标

| 指标 | 目标 |
|---|---|
| 首次冷启动 | 10-30 秒内完成资源加载，并显示进度 |
| 二次热启动 | 1 秒内进入可用状态 |
| 单次 OCR | 200-800ms，视截图质量和机器性能浮动 |
| IndexedDB 缓存查询 | 毫秒级，避免重复远程请求 |
| 远程请求超时 | 默认 1.5 秒，可在配置中调整 |
| 默认抽帧频率 | 1-2 fps |
| 内存占用 | 优先控制在 150MB 以内 |

## 9. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 浏览器捕获游戏画面黑屏 | 无法识别 | M1 优先做捕获验证，推荐窗口化或无边框窗口 |
| 浏览器后台节流 | 连续识别变慢 | 支持手动识别和前台控制台模式 |
| OCR 中文识别不稳定 | 匹配率下降 | 提供预处理参数，记录低置信度样本 |
| CORS 扩展未安装或未启用 | 远程题库请求失败 | 显示固定 CORS/网络错误文案，并指导用户启用必要站点范围的扩展 |
| 175DT 返回 403/429 | 当前分类无法继续查询 | 当前分类冷却 60 秒，防止继续高频请求 |
| 远程接口超时或结构变化 | 当前题目无法匹配 | 请求超时、协议校验、10 秒题目冷却和手动重试 |
| 数据源页面变化 | 题库构建失败 | 将爬虫和题库构建作为独立子系统 |
| 错误匹配误导用户 | 用户选错答案 | 设置置信度阈值，低置信度不强提示 |

## 10. 开发策略

开发顺序以核心风险验证为优先。

第一阶段不追求完整 UI，先验证：

- 浏览器能否稳定捕获游戏画面。
- OCR 对实际截图的准确率是否可接受。
- 远程候选匹配与答案文本映射能否容忍 OCR 噪声。

只有在这三个核心闭环跑通后，再继续完善分类树、未知题管理、自动更新和界面细节。
