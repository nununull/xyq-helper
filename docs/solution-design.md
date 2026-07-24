# 梦幻西游答题助手方案设计文档

## 1. 背景与目标

本项目用于构建一个梦幻西游答题辅助工具。工具运行在浏览器中，基于用户授权的屏幕捕获、前端 OCR、本地题库和 FTS 检索完成题目识别与答案提示。

项目目标：

- 使用 Vue3、TypeScript、Vite 构建纯前端应用。
- 不接入 LLM，不依赖服务端实时推理。
- 题库使用本地 SQLite 文件，通过 FTS 检索匹配题目。
- 首次联网下载 OCR 资源和题库，后续尽量离线运行。
- 不注入游戏进程，不 Hook 内存，不模拟键鼠输入。
- 答案提示仅显示在浏览器识别窗口内，由用户自行回到游戏窗口操作。

## 2. 产品边界

### 2.1 当前版本边界

当前方案是纯前端浏览器应用。浏览器通过 `getDisplayMedia` 获取用户授权的屏幕或窗口画面，在页面内展示识别预览和答案提示。

答案浮层是浏览器页面内的 UI 组件，只覆盖浏览器中的识别窗口或预览区域，不覆盖 Windows 系统中的梦幻西游客户端窗口。

### 2.2 明确不做

- 不做系统级透明置顶窗口。
- 不自动操作游戏。
- 不读取游戏进程、内存、网络包或本地数据。
- 不上传用户截图、题目或行为数据。
- 不承诺浏览器最小化后仍可稳定高频识别。

### 2.3 后续可选增强

如果未来必须实现真正覆盖游戏客户端窗口的系统级浮层，应另开桌面增强版本，使用 Tauri 或 Electron 实现透明置顶窗口。该能力不属于当前纯前端方案。

## 3. 总体架构

```text
Vue3 SPA
├─ 设置向导
│  ├─ 屏幕捕获授权
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
├─ 题库模块
│  ├─ questions.sqlite
│  ├─ FTS5 trigram 索引
│  └─ IndexedDB 缓存
├─ 匹配模块
│  ├─ OCR 文本清洗
│  ├─ FTS Top-K 检索
│  ├─ 选项二次校验
│  └─ 置信度计算
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
| 数据库 | JSON 静态文件 | 分享版优先使用 `questions.json` 分发题库 |
| 全文检索 | trigram 倒排索引 | 构建期生成 `trigram-index.json`，避免依赖 SQLite FTS5 |
| 本地缓存 | IndexedDB + idb | 缓存题库、语言包、配置和未知题 |
| 部署方式 | 静态托管 | 可部署到 Cloudflare Pages、Vercel 或普通静态服务器 |

## 5. 核心模块设计

### 5.1 设置向导模块

设置向导负责完成首次使用所需的基础配置。

主要能力：

- 引导用户选择要捕获的屏幕或窗口。
- 框选题干区域。
- 框选选项区域。
- 执行一次测试截图和 OCR。
- 保存配置到 IndexedDB。

配置数据结构：

```ts
export interface CaptureRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface CaptureConfig {
  questionRegion: CaptureRegion
  optionsRegion: CaptureRegion
  devicePixelRatio: number
  captureFps: number
}
```

设计要求：

- 区域坐标必须记录当时的 `devicePixelRatio`，避免 Windows 缩放导致裁剪错位。
- 用户可以随时重新框选区域。
- 测试验证界面必须展示裁剪图和 OCR 文本，方便用户判断配置是否可用。

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

### 5.6 题库模块

题库正式分享版使用 JSON 静态文件分发，浏览器首次下载后缓存到 IndexedDB。SQLite 构建保留为备用路线，不作为默认检索方案。

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

设计要求：

- `questions.json` 和 `trigram-index.json` 作为构建产物，前端运行时只读。
- 用户手动补充内容写入 `user_questions`。
- 未匹配题目写入 `unknown_questions`。
- 检索时同时查询主题库和用户补充题库。

### 5.7 匹配模块

匹配流程：

```text
OCR 结果
→ 文本清洗
→ 结构化题干和选项
→ 标准化题干
→ FTS Top-K 检索
→ 选项二次校验
→ 综合置信度计算
→ 输出答案或记录未知题
```

输出结构：

```ts
export interface MatchResult {
  questionId: number
  answer: AnswerOptionKey
  confidence: number
  matchedQuestion: string
  source: string
  category?: string
}
```

置信度组成：

- 题干匹配分。
- 选项匹配分。
- OCR 平均置信度。
- 分类过滤加权。

处理规则：

- 置信度低于阈值时不显示强答案。
- 相似题较多时展示候选结果和置信度。
- 选项校验明显冲突时记录未知题，不直接提示答案。

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
- 屏幕捕获授权状态。
- 题干区域框选入口。
- 选项区域框选入口。
- 测试截图预览。
- OCR 测试结果。
- 重新框选和确认按钮。

### 6.2 主控制台

布局采用三栏结构。

左栏：

- 活动分类树。
- 分类多选筛选。

中栏：

- 当前截图预览。
- OCR 识别文本。
- 结构化题干和选项。
- 推荐答案高亮。
- 匹配到的题库原题。

右栏：

- OCR 引擎状态。
- 题库版本和题目数量。
- 当前匹配置信度。
- 本次会话历史记录。
- 未知题数量入口。

### 6.3 未知题目管理

功能：

- 查看未匹配题目。
- 查看 OCR 原文和置信度。
- 手动选择正确答案。
- 忽略低质量识别。
- 导出 JSON。
- 将确认后的题目写入本地用户补充题库。

### 6.4 设置面板

配置项：

- 捕获频率。
- 题干区域和选项区域。
- OCR 预处理参数。
- 匹配 Top-K。
- 最小置信度。
- 题库版本。
- 缓存清理。
- 用户补充题导出。

## 7. 核心流程

### 7.1 首次启动流程

```text
打开工具
→ 检查 IndexedDB 配置
→ 无配置则进入设置向导
→ 用户授权屏幕捕获
→ 框选题干区域
→ 框选选项区域
→ 执行测试截图和 OCR
→ 用户确认配置
→ 下载或读取 OCR 语言包
→ 下载或读取 questions.sqlite
→ 初始化数据库
→ 进入主控制台
```

### 7.2 单次识别流程

```text
用户点击识别
→ 抽取当前视频帧
→ 裁剪题干和选项区域
→ 图像预处理
→ OCR 识别
→ 文本结构化
→ 题库检索
→ 选项校验
→ 显示答案或记录未知题
```

### 7.3 连续识别流程

```text
用户开启连续识别
→ 按配置频率抽帧
→ 计算帧 hash
→ 与上一帧一致则跳过
→ 与上一帧不同则执行单次识别流程
→ 输出结果
→ 等待下一轮
```

### 7.4 题库更新流程

```text
启动时读取本地题库版本
→ 请求远程版本元数据
→ 发现新版本
→ 下载新 SQLite 文件
→ 校验文件 hash
→ 写入 IndexedDB
→ 重新初始化数据库连接
```

## 8. 性能目标

| 指标 | 目标 |
|---|---|
| 首次冷启动 | 10-30 秒内完成资源加载，并显示进度 |
| 二次热启动 | 1 秒内进入可用状态 |
| 单次 OCR | 200-800ms，视截图质量和机器性能浮动 |
| 单次检索 | 5-30ms |
| 端到端识别 | 1 秒左右 |
| 默认抽帧频率 | 1-2 fps |
| 内存占用 | 优先控制在 150MB 以内 |

## 9. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 浏览器捕获游戏画面黑屏 | 无法识别 | M1 优先做捕获验证，推荐窗口化或无边框窗口 |
| 浏览器后台节流 | 连续识别变慢 | 支持手动识别和前台控制台模式 |
| OCR 中文识别不稳定 | 匹配率下降 | 提供预处理参数，记录低置信度样本 |
| FTS 依赖兼容问题 | 题库无法检索 | 提前验证 wasm 打包和 trigram，可准备轻量索引备选 |
| 首次资源较大 | 冷启动慢 | 显示进度，缓存到 IndexedDB |
| 数据源页面变化 | 题库构建失败 | 将爬虫和题库构建作为独立子系统 |
| 错误匹配误导用户 | 用户选错答案 | 设置置信度阈值，低置信度不强提示 |

## 10. 开发策略

开发顺序以核心风险验证为优先。

第一阶段不追求完整 UI，先验证：

- 浏览器能否稳定捕获游戏画面。
- OCR 对实际截图的准确率是否可接受。
- 本地题库检索能否容忍 OCR 噪声。

只有在这三个核心闭环跑通后，再继续完善分类树、未知题管理、自动更新和界面细节。
