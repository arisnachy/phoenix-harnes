# 工具可见进度实施计划

[English](2026-08-27-visible-progress-hardness.md) | 中文

**目标：**让 PHOENIX 在使用工具前解释下一步，并在回合期间显示分组、本地化且安全的进度。

**架构：**presets 要求简短开场和带证据的结尾。GUI 根据现有时间线推导 `preparing`、`running-tools` 和 `verifying`，不创建持久化事件，也不暴露参数、payload 或私有推理。

## 范围

- 将约定应用到 `standard`、`cordis` 和 `code` presets。
- 保留 `role="status"`、`aria-live="polite"`、计时器以及旧会话兼容性。
- 为英文和西班牙文状态提供本地化文本。
- 覆盖纯计算、`ChatView` 组合和工具队列的 web 场景。

## 已实现的更改

- [x] 三个 presets 在工具前叙述、分组进度，并分别给出 `IMPLEMENTADO`、`PROBADO`、`VERIFICADO` 和 `PENDIENTE`。
- [x] `turnProgress` 只分类打开回合的节点，并防御性处理不完整的根节点。
- [x] `ChatView` 显示准备、执行和验证状态，不检查敏感内容。
- [x] conversation 测试和 web 场景覆盖叙述、工具及验证的顺序。

## 证据

- 本地验证包括 conversation 和 UI 聚焦测试、类型检查与构建。
- 现有 GUI 已刷新，没有启动替代服务器。
- 发布使用专用分支，不包含凭据、令牌或 OAuth 文件。
