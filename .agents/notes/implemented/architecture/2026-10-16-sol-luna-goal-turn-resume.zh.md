# Agent Note：Sol 到 Luna 的交接可能使自动 Goal 回合中断

Status: implemented

[English](2026-10-16-sol-luna-goal-turn-resume.md) | 中文

## Problem

Lead 的 `agent/turn-stopping` 门槛原本要求*当前回合中有可执行的人类消息*。Goal 监督器使用 `source.kind=goal` 表示已授权的自动继续，因此后续 Goal 回合的 Sol 策略阶段没有 `directUserTextForTurn`。门槛在把工作从 Sol 交给 Luna 之前就返回，任务看似停止。临时 `lastRescueStep` 检查也可能在进程恢复后丢失真正的 Sol 来源，而暂时为空的选择器会遮蔽已持久化的 Auto 路由。

## Decision

只有最新持久化的 Goal 快照针对同一 ID 仍为活动状态，才识别获准的 Goal 自动继续。用户明确取消、已完成或已清除的 Goal，以及无关提供商的终止状态仍然有效。优先以真实的 Sol 模型来源作为救援凭据，仅在缺少来源时回退旧的步骤标记；即使文字续写预算已经耗尽，也应把这一有界咨询交给 Luna。只有内存选择器为空时才恢复已保存的 Auto 选择，不得覆盖当前明确选择的提供商。重复调用回合停止回调仍须幂等。

## Verification

定向模拟回归覆盖类似 Brandpoll 的第七个 Goal 回合（没有新的人类消息，Sol 指示下一步表单操作）、Luna 工具恢复、最高推理等级路由，以及已完成 Goal 不重新启动。仍需在 Windows 上使用真实中断会话并具备提供商配额进行确认。

## Consequences

用户取消、已完成的 Goal 和明确的提供商覆盖仍然优先。

## Alternatives considered

拒绝要求每次已获授权的 Goal 继续都必须收到新的人类消息，因为这会使持久自动回合停滞。
