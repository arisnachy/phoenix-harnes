# Agent Note: 在目标预订过期后唤醒待处理上下文

Status: implemented

[English](2026-10-13-goal-stale-reservation-context.md) | 中文

## Problem

当排队的人类或插件消息使自动提示的预订过期时，goal-round driver 会正确拒绝该自动提示。agent loop 会移除已领取的提案并回到 `idle`，但在 loop 已经运行时插入的唤醒消息不会再次唤醒它。因此待处理的非 goal 消息会永久留在 inbox 中；实际表现是测试等待 30 秒超时，而脚本适配器耗尽时还会出现反复恢复活动。

## Decision

保留过期预订的 fence 以及下游拒绝行为。拒绝过期提案后，driver 为该 agent 生命周期最多记录一条待处理的非 goal 消息，并等待 `agent.whenIdle()`。进入 idle 后，它移除同一条待处理消息，再通过公开的 `Agent.followup()` 唤醒路径重新投递。修复唤醒不会选择 goal 来源的消息。当下游 hook 有意返回它同时排队的上下文时，driver 会先移除排队副本，再进入返回的批次，从而保证上下文只被接纳一次，避免触发另一个恢复循环。

该修复只使用进程内调度状态。它不改变 goal revision、round 计数、已关闭 mission 的阻断、下游 `reject`、取消行为，或正数 round 来源 fence。agent 已销毁或被替换、生命周期已变化，或者待处理消息已经消失时，唤醒会安全取消。

## Alternatives considered

**直接返回过期提案中的上下文。** 已否决，因为领取之后插入的工作不属于该提案，而且下游拒绝必须保持权威。

**唤醒所有待处理消息或重试 goal。** 已否决，因为这可能重复上下文或重新制造 hot loop。driver 只选择一条现有的非 goal 消息，剩余消息由正常 inbox claim 批处理。

**修改核心 agent loop。** 已否决，因为缺陷属于 goal driver 的过期预订恢复策略；公开的 follow-up API 已经提供所需的唤醒操作。

## Consequences

- 排在过期自动 goal round 后的人类或插件消息会先得到一次正常的模型轮次，之后 goal driver 才会考虑新的 round。
- 下游 pre-step hook 返回的上下文即使也被该 hook 排队，也只会被接纳一次。
- 自动 goal 权限仍由精确预订、goal revision、active/armed 状态和 universal-mission guard 共同 fence。
- dispose 或 agent 替换期间的唤醒是尽力而为；这些生命周期转换仍保持原有的 fail-closed 行为。

## Testing

`packages/goal/goal-round-driver/tests/goal-round-driver.spec.ts` 覆盖过期预订后排队人类消息、唤醒投递失败后的恢复、goal 编辑后恢复已领取的非 goal 上下文，以及下游 hook 后重新检查 revision。Vitest 的带界限 focused run 已通过全部四个用例。prompt 断言同步更新为当前的 verification-stall 文案。
