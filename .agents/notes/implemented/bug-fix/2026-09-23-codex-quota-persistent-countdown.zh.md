# Agent Note: Codex 配额在预热期间保持可见并保留重置倒计时

Status: implemented

[English](2026-09-23-codex-quota-persistent-countdown.md) | 中文

## Problem

Settings 页脚可能在原生 `account/rateLimits/read` 完成之前就识别出已连接的 Codex 账户，尤其是在 Codex 执行状态数据库启动或 backfill 时。页面或 Host 重启后，组件级缓存为空，因此页脚会退化成通用的 `Codex …`，并暂时丢失明确的 5h/7d 窗口。折叠侧栏即使收到包含 `resetsAt` 的原生遥测，也不会显示重置倒计时。

## Decision

`CodexQuotaRemaining` 除了现有的连接级内存缓存之外，还把最近一次经过验证的配额快照保存在带版本号的浏览器存储中。页面重启后，会立即恢复最近的 5h/7d 百分比及其原生重置时间戳，同时在后台刷新 authorization RPC。确认 Codex 已断开连接时，两级缓存都会被清除。如果从未获得过有效快照，已连接账户会显示明确的 5h 和 7d 加载位置，而不是缩成通用 Codex 标签；加载状态不会虚构百分比或重置时间。

一秒一次的重置时钟现在同时服务于展开和折叠侧栏。折叠侧栏使用紧凑排版显示与展开 Settings 页脚相同的原生重置倒计时，并继续保持无进度条装饰的样式。

## Alternatives considered

**只保留内存 WeakMap。** 拒绝：它可以跨 slot 重新挂载保留数据，但无法跨浏览器刷新或 Host 重启，而这正是 Codex 原生启动最可能延迟新配额遥测的时候。

**在重置后或遥测不可用时推断 100%。** 拒绝：Phoenix 必须显示 provider 提供的遥测，不能自行推断配额容量。

**在新遥测到达前隐藏窗口。** 拒绝：这会重新引入计数器消失的问题，并移除 Phoenix 仍在预热 Codex 账户桥接器时唯一可见的状态提示。

## Consequences

在 Phoenix/Codex 启动延迟期间，最近一次真实配额继续可见，包括每个窗口距离重置的剩余时间。新的原生遥测一到达就替换已保存快照。注销不会留下陈旧配额。如果 Phoenix 没有以前可信的快照，用户会看到 5h/7d 占位和明确的重置加载标记，而不是伪造的使用量。

## Testing

聚焦的组件测试现在覆盖折叠状态下的 5h/7d 重置倒计时、明确的预热位置、内存 remount 连续性，以及原生 authorization 请求仍在等待时的持久化 reload 连续性。组装浏览器测试和完整客户端覆盖率门禁继续由 CI 负责。
