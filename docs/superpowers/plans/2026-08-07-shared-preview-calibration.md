# 共享预览校准实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户先授权并看到共享游戏画面，再在预览中校准区域并开始连续识别。

**Architecture:** `useScreenCapture` 继续独占共享流并向界面暴露预览流；纯函数负责预览坐标到视频像素坐标的换算；Dashboard 统一编排连接、校准和识别生命周期。配置用坐标空间版本淘汰旧的网页坐标。

**Tech Stack:** Vue 3、TypeScript、Pinia、Vitest、浏览器 Media Capture API。

## Global Constraints

- 所有新增或修改的方法必须有中文职责注释。
- 不为兼容单元测试增加无意义的运行时分支。
- 不修改 `crawler/`、`data/` 和用户未提交的无关改动。

---

### Task 1: 视频像素坐标配置

**Files:**
- Modify: `src/types/capture.ts`
- Modify: `src/types/config.ts`
- Modify: `src/features/setup/applyCaptureRegion.ts`
- Test: `src/types/config.test.ts`
- Test: `src/features/setup/applyCaptureRegion.test.ts`

- [ ] 先写旧配置失效、新配置写入 `video-pixel-v1` 的失败测试。
- [ ] 运行聚焦测试并确认因字段缺失失败。
- [ ] 增加坐标空间版本和 `hasValidCaptureRegions`，保存区域时写入版本。
- [ ] 运行聚焦测试确认通过。

### Task 2: 共享流预览与坐标换算

**Files:**
- Modify: `src/composables/useScreenCapture.ts`
- Modify: `src/composables/useScreenCapture.test.ts`
- Create: `src/features/setup/previewCoordinates.ts`
- Create: `src/features/setup/previewCoordinates.test.ts`

- [ ] 先写共享流可读取、裁剪不乘 DPR、预览坐标换算的失败测试。
- [ ] 运行聚焦测试确认失败原因正确。
- [ ] 暴露 `getActiveStream`，以视频像素坐标裁剪并实现换算纯函数。
- [ ] 运行聚焦测试确认通过。

### Task 3: 实时预览校准组件

**Files:**
- Create: `src/components/CaptureCalibration.vue`
- Modify: `src/assets/styles/main.css`

- [ ] 实现共享视频渲染、两步框选、取消和完成事件。
- [ ] 保证框选区域按预览容器边界裁切并输出视频像素坐标。
- [ ] 使用中文步骤提示和可见操作反馈。

### Task 4: 主控制台连续流程

**Files:**
- Modify: `src/App.vue`
- Modify: `src/components/Dashboard.vue`
- Delete: `src/components/SetupWizard.vue`
- Delete: `src/components/AreaSelector.vue`

- [ ] App 始终进入 Dashboard，不再被旧向导阻挡。
- [ ] Dashboard 实现选择分类、连接、首次校准、自动启动、重新校准和停止。
- [ ] 删除页面隐藏即停止共享的逻辑。
- [ ] 为禁用按钮显示明确原因，并保留用户当前标题改动。

### Task 5: 验证

**Files:**
- Modify: `docs/solution-design.md`

- [ ] 更新使用流程和坐标模型说明。
- [ ] 运行 `npm run test:run`。
- [ ] 运行 `npm run build` 和 `git diff --check`。
- [ ] 启动 Vite，用浏览器验证首次入口、分类选择和授权触发顺序。
