# Agent Note：HARDNESS mission authority precedence

Status: implemented

[English](2026-09-15-hardness-mission-authority-precedence.md) | 中文

## Problem

持久化 HARDNESS mission kernel 会协调 approval、goal、judge、router、executor 与 presentation，但此前没有记录这些层在产生冲突决定时如何解析。这样较低 authority 的 executor 或 presentation 结果可能看起来覆盖了较高 authority 的 safety、approval、goal 或 judge 决定，却没有 durable reason。

## 决策

mission kernel 拥有不可变的 authority 顺序：`safety > approval > goal > judge > router > executor > presentation`。`resolveMissionAuthorityConflict()` 对不同 authority 返回较高者，对相同 authority 返回 blocked tie。`recordAuthorityConflict()` 追加包含两个 authority、resolution、reason 与 mission status 的 `authority-conflict` event。

较高 authority 的冲突会记录 winning authority，但不会绕过该层自己的 gate。相同 authority 的冲突会进入 `WAITING_EXTERNAL`，并通过现有 resume path 保持可恢复。Replay 从 durable event 恢复 conflict list 与 status；它不会依据 event 顺序或 model-visible result 推断 authority。

approval denial path 会在报告 blocked mission 之前记录 `approval` 与 `executor` 的冲突。这使 denial precedence 可审计，并防止失败或延迟的 execution result 被当作继续执行的 permission。

## 验证

mission-kernel tests 覆盖完整 precedence 顺序、不同 authority 的解析、相同 authority 的阻塞、durable event 字段与 replay 恢复。mission-orchestrator tests 覆盖 approval-denial conflict 与 blocked result。HARDNESS 与 adapter typecheck、syntax checks 以及 native transformed kernel smoke 已通过；focused Vitest runner 仍被 Windows `spawn EPERM` 阻塞，错误发生在 test discovery 之前。

## 后果

每个 authority dispute 都有稳定且可 replay 的解释，相同 authority 的歧义会 fail closed 而不是按 timing 选择。Kernel 增加了少量 event vocabulary 与 state field，序列化或 replay mission state 的 consumer 必须保留它们。Authority resolution 只负责 mission protocol decisions，不授予 permission、不执行 capability，也不替代 approval broker。

## Alternatives considered

**使用 event 顺序作为 precedence。** 拒绝，因为异步完成顺序不是 policy authority，会使 retry、replay 与 late result 不具确定性。

**由 executor 或 judge 在本地负责 precedence。** 拒绝，因为每个 owner 只会编码部分顺序，durable session 可能对最终决定产生分歧。

**阻塞所有 conflict，包括不同 authority。** 拒绝，因为已声明的较高 authority 决定可以确定性记录，同时仍保留该 authority 自己的 gate；只有相同 authority 天生具有歧义。
