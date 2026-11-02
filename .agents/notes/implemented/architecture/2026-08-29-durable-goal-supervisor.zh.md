# Agent Note: 持久化 goal supervisor 检查点

Status: implemented

[English](2026-08-29-durable-goal-supervisor.md) | 中文

## Problem

Goal 续行状态以 goal 和 judge 事件持久化，但重启后没有保存 supervisor 下一步动作或上次排队失败的有界记录。操作员可以看到 goal phase，却没有持久化的恢复检查点。

## Decision

Goal domain 拥有仅记录日志的 `goal/supervisor` 事件。goal-round driver 在观察到 goal 生命周期变更、准备续行或排队失败时写入检查点。会话启动时重放最新检查点。检查点只包含 goal 身份、revision、轮次计数、有界的状态和动作枚举、尝试计数以及截断后的错误摘要。

重放只恢复诊断，不恢复权限。会话启动仍会停用进程内 driver，只有精确的直接人类 `update_goal resume` 变更才能重新启用 goal。这避免重启进程仅因为旧会话仍处于 active 就修改工作区。

## Alternatives considered

- **持久化进程内启用状态并自动恢复。** 拒绝，因为重启不应在没有新的人类指令时重新获得工作区修改权限。
- **使用 `goal/change` 保存 supervisor 状态。** 拒绝，因为 supervisor 检查点是运行诊断，不应改变 goal 生命周期或其 compare-and-set revision。
- **不限制地保存 provider 错误文本。** 拒绝，因为 provider 输出可能包含秘密或无界数据；检查点只保留短且规范化的摘要。

## Consequences

恢复工具可以显示任务在做什么以及下一步应做什么，而不需要解析 provider 输出或秘密。持久化失败会停用续行，并通过现有 logger 可见。检查点只追加并可在 JSONL 和 SQLite 会话持久化中保留。
