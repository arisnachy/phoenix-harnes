# updater 可见性与 OpenAI Codex 配额设计

[English](2026-08-27-sidebar-update-codex-quota-design.md) | 中文

## 目标

修复 PHOENIX 侧边栏：没有更新时不占用空间；只有兼容路由拥有有效遥测时，才在 `Settings` 旁显示 OpenAI/Codex 账户配额。

## 决策

1. `paused` 是有效的 Host 状态，可用于诊断；但没有可操作更新时不渲染。
2. `CodexQuotaRemaining` 负责配额，不复制 `openai/codex` 仓库中的代码。
3. 组件只在 `wide`、会话有效、提供方为 OpenAI/Codex 且限制窗口为有限数值并在范围内时渲染。
4. 可见值是剩余百分比：`clamp(round(100 - usedPercent), 0, 100)`。

## 测试

- updater 映射确认 `paused` 不产生标签或 DOM。
- 配额覆盖缺失遥测、无效值、窗口优先级和提供方切换。
- 发布前运行构建、类型检查、聚焦测试并刷新 GUI。

## 安全

不显示令牌、密钥、payload 或授权响应。只暴露由已授权遥测推导的百分比。
