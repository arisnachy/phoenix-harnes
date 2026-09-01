# Agent Note: stable channel divergence recovery

Status: implemented

[English](2026-08-31-stable-divergence-recovery.md) | 中文

## Problem

在经过有意的发布替换后，提升的 `stable` 分支可能拥有无关的历史。updater 把这种关系当作不安全失败处理，开发 checkout 也隐藏了 stable 已可用的事实。

## Decision

在选择 updater 动作前先分类观察到的关系。只有在现有 staging、锁定安装、构建和 smoke-test gate 全部通过后，受管理的 `main` 或 `stable` checkout 才可以替换无关历史。开发分支和未受管理的 checkout 仍受到保护。当 stable 前进时，watcher 会在开发分支记录带有 stable 目标的 `available`，让 UI 显示更新而不修改 checkout。重启激活接受相同的受保护替换路径，并保留指向上一发布版本的恢复 ref。

## Alternatives considered

**始终使用 fast-forward。** 拒绝，因为无关发布历史无法 fast-forward，受管理的安装将永远无法接收提升的 stable 发布。

**将每个 checkout 都重置到 stable。** 拒绝，因为开发工作和未受管理的本地修改绝不能被自动覆盖。

**开发分支只显示暂停状态。** 拒绝，因为这会隐藏应用中可操作的 stable 更新；checkout 仍受保护，同时更新变得可见。

## Consequences

受管理的发布安装可以从历史替换中恢复而无需手动破坏性 reset，同时通过恢复 ref 保留上一段历史。开发和未受管理的 checkout 仍然 fail closed。stable 前进时 UI 现在拥有可持久渲染的事实，而 checkout 已是最新版本时不显示更新卡片。

## Testing

策略测试通过 3/3 个用例。基于上一发布版本的临时 stable checkout 检测到无关历史，完成了完整 staging 构建和 launcher smoke test，并在提升的 stable commit 上以 `updated/complete` 结束。TypeScript typecheck、updater/UI 聚焦测试、语法检查和文档 gate 均通过。
