# 梦幻西游答题助手任务执行计划

> [!WARNING]
> **历史计划 / 已废弃**
>
> 本文记录早期本地题库方案，仅用于追溯历史，**不得再作为当前运行时实现依据**。当前实时查询设计与执行依据请以以下文档为准：
>
> - [实时题目查询设计](./superpowers/specs/2026-08-06-frontend-realtime-question-query-design.md)
> - [实时题目查询实施计划](./superpowers/plans/2026-08-06-frontend-realtime-question-query.md)

> **历史原文（不得执行）：** 旧计划曾要求 agentic workers 使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 逐项实施；该行为要求已随本文废弃，不得用于当前任务。

**Goal:** 构建一个 Vue3 + TypeScript + Vite 纯前端答题助手，完成屏幕捕获、OCR、题库检索和浏览器内答案提示的可用闭环。

**Architecture:** 应用按捕获、预处理、OCR、解析、题库、匹配、UI 状态拆分。M1 优先验证屏幕捕获和手动题库匹配，后续逐步接入 OCR、SQLite FTS、未知题管理和题库更新。

**Tech Stack:** Vue3、TypeScript、Vite、Pinia、Tesseract.js、SQLite wasm、FTS5 trigram、IndexedDB、idb、Canvas 2D API。

## Global Constraints

- 操作系统以 Windows 为主要目标环境。
- 语言、注释、文档均使用中文。
- 代码必须保持可读性。
- 代码注释必须清晰、必要、完善。
- 测试文件只用于验证时，测试完成后按用户要求及时删除。
- 当前版本是纯前端浏览器应用。
- 答案浮层只显示在浏览器识别窗口内，不覆盖 Windows 游戏客户端窗口。
- 不接入 LLM。
- 不注入游戏进程。
- 不模拟鼠标或键盘输入。
- 不上传截图、题目或用户行为数据。

---

## 1. 文件结构规划

计划创建以下项目结构：

```text
src/
├─ main.ts
├─ App.vue
├─ types/
│  ├─ capture.ts
│  ├─ config.ts
│  ├─ ocr.ts
│  ├─ question.ts
│  └─ match.ts
├─ stores/
│  ├─ capture.ts
│  ├─ config.ts
│  ├─ ocr.ts
│  ├─ db.ts
│  └─ matcher.ts
├─ composables/
│  ├─ useScreenCapture.ts
│  ├─ useAreaSelector.ts
│  ├─ useOCR.ts
│  └─ useSQLiteDB.ts
├─ utils/
│  ├─ frameHash.ts
│  ├─ preprocess.ts
│  ├─ normalizeText.ts
│  ├─ parseQuestion.ts
│  └─ matcher.ts
├─ components/
│  ├─ SetupWizard.vue
│  ├─ AreaSelector.vue
│  ├─ CapturePreview.vue
│  ├─ OCRResult.vue
│  ├─ AnswerOverlay.vue
│  ├─ Dashboard.vue
│  ├─ SettingsPanel.vue
│  └─ UnknownQuestions.vue
└─ assets/
   └─ styles/
      ├─ variables.css
      └─ main.css
```

开发脚本与静态资源：

```text
scripts/
└─ build-db.mjs

public/
├─ data/
│  ├─ questions.sqlite
│  └─ version.json
├─ wasm/
└─ lang-data/
```

## 2. 任务拆分

### Task 1: 初始化 Vue3 + TypeScript + Vite 项目

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `src/App.vue`
- Create: `src/assets/styles/variables.css`
- Create: `src/assets/styles/main.css`

**Interfaces:**

- Produces: 可运行的 Vue3 应用入口。
- Produces: 全局样式变量和基础布局。

**Steps:**

- [ ] 创建 Vite + Vue3 + TypeScript 基础文件。
- [ ] 安装运行依赖：`vue`、`pinia`、`idb`。
- [ ] 安装开发依赖：`typescript`、`vite`、`@vitejs/plugin-vue`。
- [ ] 在 `src/main.ts` 注册 Pinia。
- [ ] 在 `src/App.vue` 渲染基础应用壳。
- [ ] 运行 `npm run dev`，确认开发服务器启动。
- [ ] 运行 `npm run build`，确认 TypeScript 和 Vite 构建通过。

**Verification:**

```powershell
npm install
npm run build
```

Expected: 构建成功，生成 `dist/`。

### Task 2: 定义核心类型

**Files:**

- Create: `src/types/capture.ts`
- Create: `src/types/config.ts`
- Create: `src/types/ocr.ts`
- Create: `src/types/question.ts`
- Create: `src/types/match.ts`

**Interfaces:**

- Produces: `CaptureRegion`
- Produces: `CaptureConfig`
- Produces: `CaptureFrame`
- Produces: `OCRResult`
- Produces: `ParsedQuestion`
- Produces: `MatchResult`

**Steps:**

- [ ] 在 `capture.ts` 定义截图区域、捕获状态和帧数据类型。
- [ ] 在 `config.ts` 定义用户配置和默认配置类型。
- [ ] 在 `ocr.ts` 定义 OCR 文本块、OCR 状态和 OCR 结果类型。
- [ ] 在 `question.ts` 定义题目、选项、分类和未知题类型。
- [ ] 在 `match.ts` 定义匹配候选、匹配结果和置信度结构。
- [ ] 为每个类型补充中文注释，说明用途和边界。
- [ ] 运行 `npm run build`，确认类型无误。

**Verification:**

```powershell
npm run build
```

Expected: TypeScript 编译通过。

### Task 3: 实现屏幕捕获最小闭环

**Files:**

- Create: `src/composables/useScreenCapture.ts`
- Create: `src/utils/frameHash.ts`
- Modify: `src/stores/capture.ts`
- Modify: `src/components/CapturePreview.vue`
- Modify: `src/components/Dashboard.vue`

**Interfaces:**

- Consumes: `CaptureConfig`
- Produces: `startCapture(): Promise<void>`
- Produces: `stopCapture(): void`
- Produces: `captureCurrentFrame(): CaptureFrame | null`

**Steps:**

- [ ] 实现 `useScreenCapture.ts`，封装 `navigator.mediaDevices.getDisplayMedia`。
- [ ] 使用隐藏 `video` 元素承载屏幕流。
- [ ] 使用 Canvas 抽取当前帧。
- [ ] 根据配置裁剪题干区域和选项区域。
- [ ] 实现 `frameHash.ts`，对低分辨率采样像素生成简单 hash。
- [ ] 在 `capture` store 中记录授权状态、捕获状态、错误信息和最近一帧。
- [ ] 在 `CapturePreview.vue` 显示当前捕获预览。
- [ ] 在 `Dashboard.vue` 增加开始捕获、停止捕获、截图一次按钮。
- [ ] 运行浏览器手动验证窗口化游戏或普通窗口是否能被捕获。

**Verification:**

```powershell
npm run build
```

Expected: 构建成功；手动验证能看到捕获预览。

### Task 4: 实现区域框选配置

**Files:**

- Create: `src/composables/useAreaSelector.ts`
- Create: `src/components/AreaSelector.vue`
- Create: `src/components/SetupWizard.vue`
- Modify: `src/stores/config.ts`
- Modify: `src/App.vue`

**Interfaces:**

- Consumes: 捕获视频或截图预览。
- Produces: `questionRegion: CaptureRegion`
- Produces: `optionsRegion: CaptureRegion`

**Steps:**

- [ ] 实现 `useAreaSelector.ts`，处理鼠标按下、拖动、松开。
- [ ] 在 `AreaSelector.vue` 显示半透明遮罩、选择框和尺寸提示。
- [ ] 在 `SetupWizard.vue` 实现准备、框选题干、框选选项、测试验证四个步骤。
- [ ] 在 `config` store 中保存区域配置、DPI 和抽帧频率。
- [ ] 将配置持久化到 IndexedDB。
- [ ] 应用启动时读取配置，有配置进入主控制台，无配置进入设置向导。
- [ ] 运行构建并手动验证重新框选流程。

**Verification:**

```powershell
npm run build
```

Expected: 构建成功；刷新页面后配置仍能恢复。

### Task 5: 实现图像预处理

**Files:**

- Create: `src/utils/preprocess.ts`
- Modify: `src/components/CapturePreview.vue`
- Modify: `src/components/SettingsPanel.vue`

**Interfaces:**

- Consumes: `ImageData`
- Produces: `preprocessImage(image, options): ImageData`

**Steps:**

- [ ] 实现灰度化。
- [ ] 实现固定阈值二值化。
- [ ] 实现 2 倍 Canvas 放大。
- [ ] 在设置面板提供灰度、二值化、缩放倍数配置。
- [ ] 在截图预览中同时显示原图和预处理图。
- [ ] 使用实际游戏截图手动比较预处理效果。
- [ ] 运行构建。

**Verification:**

```powershell
npm run build
```

Expected: 构建成功；预处理预览可见且不报错。

### Task 6: 接入 Tesseract.js OCR

**Files:**

- Create: `src/composables/useOCR.ts`
- Modify: `src/stores/ocr.ts`
- Modify: `src/components/OCRResult.vue`
- Modify: `src/components/Dashboard.vue`

**Interfaces:**

- Consumes: `ImageData`
- Produces: `initializeOCR(): Promise<void>`
- Produces: `recognizeFrame(frame: CaptureFrame): Promise<OCRResult>`

**Steps:**

- [ ] 安装 `tesseract.js`。
- [ ] 在 `useOCR.ts` 初始化中文简体 Worker。
- [ ] 复用同一个 Worker，不在每次识别时重复初始化。
- [ ] 将题干图和选项图分别送入 OCR。
- [ ] 在 `ocr` store 中保存初始化状态、识别中状态、错误信息和最近结果。
- [ ] 在 `OCRResult.vue` 展示 OCR 原文、置信度和耗时。
- [ ] 在主控制台增加“截图并 OCR”按钮。
- [ ] 使用实际截图验证 OCR 输出。

**Verification:**

```powershell
npm run build
```

Expected: 构建成功；手动点击后能看到 OCR 文本或明确错误提示。

### Task 7: 实现 OCR 文本标准化和题目解析

**Files:**

- Create: `src/utils/normalizeText.ts`
- Create: `src/utils/parseQuestion.ts`
- Modify: `src/components/OCRResult.vue`

**Interfaces:**

- Consumes: `OCRResult`
- Produces: `normalizeQuestionText(text: string): string`
- Produces: `parseQuestion(result: OCRResult): ParsedQuestion`

**Steps:**

- [ ] 实现去空白、统一标点、移除异常字符的标准化函数。
- [ ] 实现 A/B/C/D 选项识别。
- [ ] 对无法识别完整选项的情况返回部分选项，并保留原文。
- [ ] 在 OCR 结果组件中展示结构化题干和选项。
- [ ] 用 5-10 条真实 OCR 样本做临时测试脚本验证解析效果。
- [ ] 测试完成后删除临时测试脚本。
- [ ] 运行构建。

**Verification:**

```powershell
npm run build
```

Expected: 构建成功；真实样本能被解析为题干和选项。

### Task 8: 建立本地小题库和匹配算法

**Files:**

- Create: `src/utils/matcher.ts`
- Modify: `src/stores/matcher.ts`
- Modify: `src/components/AnswerOverlay.vue`
- Modify: `src/components/Dashboard.vue`

**Interfaces:**

- Consumes: `ParsedQuestion`
- Produces: `matchQuestion(parsed: ParsedQuestion): MatchResult | null`

**Steps:**

- [ ] 先在前端内置 50 条开发测试题，作为 M1 小题库。
- [ ] 实现题干相似度计算。
- [ ] 实现选项二次校验。
- [ ] 实现置信度计算。
- [ ] 置信度低于阈值时不显示强答案。
- [ ] 在 `matcher` store 中保存候选列表、最终结果和置信度。
- [ ] 在 `AnswerOverlay.vue` 显示浏览器内答案浮层。
- [ ] 在主控制台串联“截图 → OCR → 解析 → 匹配 → 显示答案”流程。
- [ ] 运行构建并手动验证完整闭环。

**Verification:**

```powershell
npm run build
```

Expected: 构建成功；测试题能输出正确答案。

### Task 9: 接入 IndexedDB 持久化

**Files:**

- Create: `src/composables/useLocalStorageDB.ts`
- Modify: `src/stores/config.ts`
- Modify: `src/stores/db.ts`
- Modify: `src/stores/matcher.ts`

**Interfaces:**

- Produces: `saveConfig(config): Promise<void>`
- Produces: `loadConfig(): Promise<AppConfig | null>`
- Produces: `saveUnknownQuestion(question): Promise<void>`
- Produces: `listUnknownQuestions(): Promise<UnknownQuestion[]>`

**Steps:**

- [ ] 安装并配置 `idb`。
- [ ] 创建 IndexedDB 数据库版本 1。
- [ ] 建立 `config`、`unknown_questions`、`user_questions` 对象仓库。
- [ ] 将框选配置保存到 IndexedDB。
- [ ] 将未匹配题目保存到 IndexedDB。
- [ ] 增加清除缓存能力。
- [ ] 运行构建并手动验证刷新后数据仍存在。

**Verification:**

```powershell
npm run build
```

Expected: 构建成功；配置和未知题可持久化。

### Task 10: 接入 SQLite FTS 题库

**Files:**

- Create: `src/composables/useSQLiteDB.ts`
- Create: `scripts/build-db.mjs`
- Create: `public/data/version.json`
- Modify: `src/stores/db.ts`
- Modify: `src/utils/matcher.ts`

**Interfaces:**

- Produces: `initializeQuestionDB(): Promise<void>`
- Produces: `searchQuestions(query: ParsedQuestion, topK: number): Promise<MatchCandidate[]>`

**Steps:**

- [ ] 验证 SQLite wasm 依赖在 Vite 下的加载方式。
- [ ] 编写 `build-db.mjs`，将 JSON 题库构建为 `questions.sqlite`。
- [ ] 创建 `questions`、`questions_fts`、`categories` 表。
- [ ] 生成 `public/data/version.json`，包含版本号、题目数量和 hash。
- [ ] 在 `useSQLiteDB.ts` 加载 SQLite 文件。
- [ ] 将 SQLite 文件缓存到 IndexedDB。
- [ ] 将匹配算法从内置小题库切换为 SQLite FTS Top-K。
- [ ] 保留小题库作为开发回退方案。
- [ ] 运行构建并手动验证 FTS 检索。

**Verification:**

```powershell
npm run build
```

Expected: 构建成功；SQLite 题库可加载并返回候选题。

### Task 11: 实现未知题目管理

**Files:**

- Create: `src/components/UnknownQuestions.vue`
- Modify: `src/stores/db.ts`
- Modify: `src/utils/matcher.ts`
- Modify: `src/components/Dashboard.vue`

**Interfaces:**

- Consumes: `UnknownQuestion`
- Produces: `confirmUnknownQuestion(id, answer): Promise<void>`
- Produces: `exportUnknownQuestions(): string`

**Steps:**

- [ ] 匹配失败时写入未知题表。
- [ ] 展示未知题列表、OCR 置信度和创建时间。
- [ ] 支持用户手动选择答案。
- [ ] 确认后写入 `user_questions`。
- [ ] 支持忽略未知题。
- [ ] 支持导出 JSON。
- [ ] 检索时同时查询主题库和用户补充题。
- [ ] 运行构建并手动验证未知题闭环。

**Verification:**

```powershell
npm run build
```

Expected: 构建成功；未知题可确认、忽略和导出。

### Task 12: 完善设置面板和错误恢复

**Files:**

- Create: `src/components/SettingsPanel.vue`
- Modify: `src/stores/config.ts`
- Modify: `src/stores/ocr.ts`
- Modify: `src/stores/db.ts`
- Modify: `src/components/Dashboard.vue`

**Interfaces:**

- Produces: 设置项读写能力。
- Produces: OCR、捕获、数据库错误恢复入口。

**Steps:**

- [ ] 实现抽帧频率配置。
- [ ] 实现 OCR 预处理参数配置。
- [ ] 实现匹配阈值和 Top-K 配置。
- [ ] 实现重新初始化 OCR。
- [ ] 实现重新加载题库。
- [ ] 实现清除缓存。
- [ ] 实现重置框选配置。
- [ ] 为常见错误显示中文说明。
- [ ] 运行构建。

**Verification:**

```powershell
npm run build
```

Expected: 构建成功；设置项变更后能保存并生效。

### Task 13: 性能与可用性验证

**Files:**

- Modify: `src/stores/ocr.ts`
- Modify: `src/stores/matcher.ts`
- Modify: `src/components/Dashboard.vue`
- Modify: `docs/solution-design.md`

**Interfaces:**

- Produces: 识别耗时、OCR 耗时、检索耗时、端到端耗时展示。

**Steps:**

- [ ] 记录每次 OCR 耗时。
- [ ] 记录每次检索耗时。
- [ ] 记录端到端识别耗时。
- [ ] 在主控制台状态栏展示性能数据。
- [ ] 使用至少 20 张真实截图手动验证识别效果。
- [ ] 记录 OCR 失败样本和误匹配样本。
- [ ] 根据验证结果调整默认阈值。
- [ ] 更新方案文档中的已验证限制。
- [ ] 运行构建。

**Verification:**

```powershell
npm run build
```

Expected: 构建成功；状态栏能展示性能数据。

## 3. 推荐执行顺序

优先顺序：

1. Task 1 到 Task 4：验证浏览器捕获与框选。
2. Task 5 到 Task 8：跑通截图、OCR、解析、匹配、提示闭环。
3. Task 9 到 Task 11：加入持久化、SQLite 题库和未知题闭环。
4. Task 12 到 Task 13：完善设置、错误恢复和性能验证。

## 4. 阶段验收标准

### M1 骨架验收

- 能启动 Vue 应用。
- 能授权屏幕捕获。
- 能框选题干和选项区域。
- 能显示截图预览。
- 能使用内置小题库匹配并显示答案。

### M2 OCR 验收

- 能加载 OCR Worker。
- 能识别真实游戏截图中的中文题目。
- 能解析出题干和至少部分选项。
- 低置信度结果不会强行提示答案。

### M3 题库验收

- 能加载 SQLite 题库。
- 能通过 FTS 检索候选题。
- 能结合选项校验输出答案。
- 未匹配题能进入未知题管理。

### M4 产品验收

- 设置项可持久化。
- 题库可缓存。
- 用户补充题可参与检索。
- 常见错误有中文提示。
- 完整构建通过。

## 5. 自检清单

- [ ] 文档中没有承诺浏览器外系统级浮层。
- [ ] 文档中没有自动答题或模拟输入设计。
- [ ] 每个模块都有清晰输入和输出。
- [ ] 每个任务都能独立验证。
- [ ] 所有新增代码都需要中文注释。
- [ ] 临时测试文件在验证完成后删除。
- [ ] 每个阶段都以 `npm run build` 作为最低验证门槛。

