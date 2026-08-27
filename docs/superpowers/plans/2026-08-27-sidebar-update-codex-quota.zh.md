# 侧边栏、updater 与 Codex 配额实施计划

[English](2026-08-27-sidebar-update-codex-quota.md) | 中文

**目标：**隐藏没有可用操作的 updater 状态，并且仅在 OpenAI/Codex 路由拥有有效遥测时，在 `Settings` 旁显示账户剩余配额。

**架构：**`UpdateFooterAction` 在不改变 Host 约定的情况下决定可见性。`CodexQuotaRemaining` 使用每个会话的模型目录和 `authorization.list({})`；不复制 `openai/codex` 模块，也不把账户配额与上下文占用混合。

**所需验证：**运行聚焦测试、`pnpm typecheck`、`pnpm build`，刷新现有 GUI，并检查没有敏感信息泄漏。

## 已实现的更改

- [x] 当 `paused` 不代表可操作的更新时将其隐藏；它仍保留在约定中用于诊断。
- [x] 配额使用 `100 - usedPercent`，限制在 `0–100`，并忽略缺失、非有限或越界遥测。
- [x] 如果 `primaryLimit` 无效，则使用第一个有效的 `secondaryLimit`。
- [x] 指示器注册到 `settings.trigger.trailing`，不适用时不留下空间。
- [x] 测试覆盖兼容提供方、其他提供方、提供方切换、缺失遥测和无效值。

## 本地证据

- 聚焦测试：3 个文件，44 个测试通过。
- 完整类型检查：退出代码 0。
- 完整构建：退出代码 0。
- GUI `http://127.0.0.1:3080`：页面已渲染，没有“更新已暂停”，且实时授权没有提供遥测时不会伪造百分比。

## 发布

- [x] 分支 `kira/visible-progress-hardness` 已发布到 `origin`。
- [x] PR #60 已标记为请求审查，不再是 draft。
- [ ] 仅当所有必需检查通过时才合并到 `main`。
