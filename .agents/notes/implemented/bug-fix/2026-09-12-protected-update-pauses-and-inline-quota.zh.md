# Agent Note: Protected updater pauses stay quiet and quota sits inline

Status: implemented

[English](2026-09-12-protected-update-pauses-and-inline-quota.md) | 中文

## Problem

稳定更新器在本地 checkout 受到自动历史变更保护时记录 paused 状态，包括开发分支、分叉历史、领先的 checkout 或外部 remote。把所有 paused 状态都渲染成侧边栏操作，会把仓库保护显示成更新错误，并提供一个无法改变受保护 checkout 的重试操作。

Codex 配额页脚使用圆角容器、渐变、阴影、圆形计量器，以及为主窗口和次窗口分别设置的强调色。这种处理把配额与 Settings 行分开，而不是让限制成为同一窗口的一部分。

## Decision

`packages/client/ui-settings-plugin-inventory/src/client/update-presentation.ts` 中的 `isHiddenUpdaterPause` 识别五个只表达策略决定的更新器阶段。`updateLabelKey` 使用该函数，同时保留现有的开发分支详情保护。没有这些阶段的操作性暂停仍然可见，`error` 和 `rollback-failed` 也继续显示并保留重试行为。

`CodexQuotaRemaining.module.css` 让两个配额窗口与 Settings 页脚 inline 显示。根元素没有背景、边框、圆角或阴影；计量器和重置文字使用 Settings 的标签 token；主窗口和次窗口共享同一个中性 token。两个窗口、重置倒计时、可访问标签和响应式间距保持不变。

## Alternatives considered

**在更新器中清除策略暂停状态。** 拒绝：持久化状态仍然有诊断价值，更新器必须继续保护未管理的 checkout，避免破坏性替换。

**为每个 paused 状态显示重试操作。** 拒绝：重试适用于操作性阻塞的更新，不适用于分支、历史或 remote 的策略决定。

**保留圆形配额计量器，只将颜色改为中性。** 拒绝：圆形计量器仍然是独立的视觉徽章；inline 文字能让配额留在 Settings 页脚中，不再创建竞争性的表面。

## Consequences

受保护的本地 checkout 不再在 Settings 页脚创建持久的可操作提醒，而真实的准备、激活、回滚和传输失败继续保留现有的用户可见行为。更新器的自动重试和安全激活规则不变。

配额值使用与 Settings 相同的标签层级，视觉强调和装饰更少。现有的配额数据属性，以及组和各窗口的可访问标签，仍然可供测试和辅助技术使用。

## Testing

纯展示和 CSS 回归测试使用 Vitest 单线程池执行：3 个测试通过。聚焦的 React 测试套件通过 60 个测试，其中包括受保护暂停分类、配额窗口、重置倒计时、provider 过滤和重试行为。
