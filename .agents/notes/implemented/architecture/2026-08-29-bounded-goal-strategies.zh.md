# Agent Note: 有界 goal 策略选择

Status: implemented

[English](2026-08-29-bounded-goal-strategies.md) | 中文

## Problem

Goal driver 可以在失败轮次后要求采用不同方法，但没有记录选择了哪一种恢复策略。后续进程无法区分有意的策略变化和普通 prompt 文本。

## Decision

Goal domain 拥有仅记录日志的 `goal/strategy` 事件。每次续行 prompt 前，driver 从四个固定策略中选择并记录一个：`baseline`、`verification-first`、`alternate-tool` 或 `minimal-change`。选择由上一个持久化策略和已准入轮次确定，并且不会再次选择刚刚使用的策略。选择的 id 会加入规范 prompt，invariant 从 prompt 前的事件重建它。

## Alternatives considered

- **让模型发明未记录的策略名称。** 拒绝，因为恢复选择不会有界或可重放。
- **随机选择。** 拒绝，因为非确定性 prompt 会使重放和调试不可靠。
- **只持久化 prompt 文本。** 拒绝，因为这无法提供有类型的 supervisor 操作记录。

## Consequences

每个自动轮次都有可审计的策略决定，修复 prompt 可以证明要求了实质性变化。有限轮换保持保守；新的 goal revision 可以通过人类 resume 或后续策略重新开始序列。
