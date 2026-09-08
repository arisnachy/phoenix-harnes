# Agent Note: 最新目标评审决定评审权限

Status: implemented

[English](2026-09-07-latest-goal-judge-authority.md) | 中文

## Problem

目标完成会接受当前修订版本中记录的任何通过评审，因此后续的 `needs_changes` 或 `blocked` 评审无法撤销较早的通过结果。同一会话驱动器又独立选择最新的非通过评审，所以后续通过后仍可能重放过时的修复发现。

## Decision

对于精确的 `{ goalId, revision }`，完成逻辑读取最新的 `goal/judge` 事件，并要求其 verdict 为 `pass`。Round 驱动器及其提示词不变量读取同一个精确修订版本的事件，并且仅在最新 verdict 为非通过时提供反馈。因此后续通过会抑制较早的发现，而后续非通过评审会一直拥有权限，直到另一条评审取代它。

## Verification

Goal 服务回归覆盖 `pass` 后接 `needs_changes` 时拒绝完成，以及 `needs_changes` 后接 `pass` 时接受完成。驱动器集成测试和不变量回归覆盖后续通过后抑制早先 `needs_changes` 发现。Goal 与驱动器聚焦 Vitest 文件共同通过。

## Alternatives considered

- **保持历史通过结果拥有权限：** 后续评审发现必需更改后仍可完成目标。
- **继续选择最新的非通过评审：** 后续通过后仍会重放过时的修复指令。
- **使用会话范围内的最新评审：** 可能把另一个目标修订版本的判断应用到当前交付物。

## Consequences

评审历史仍然只追加，但只有最新的精确修订版本评审决定完成与修复反馈。使用新的目标修订版本重新开始工作时，会自然忽略早期修订版本的评审。通过评审本身不会完成目标；现有完成门禁和显式完成调用仍然是必需的。
