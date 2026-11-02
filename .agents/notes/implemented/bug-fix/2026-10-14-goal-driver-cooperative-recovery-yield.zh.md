# Agent Note：重复目标恢复之间的协作让步

Status: implemented

[English](2026-10-14-goal-driver-cooperative-recovery-yield.md) | 中文

## Problem

当提供方失败在同一个 driver 任务仍运行时同步请求下一次 goal recovery，`requestDrive` 可能只消耗 microtask，让取消或 teardown timer 无法运行。完整 goal-round 文件在 40 个已完成用例后保持运行而没有摘要；聚焦的取消用例还暴露出一个无效 fixture：它在 `inbox/inserted` 期间调用 `Agent.cancel()`，此时 agent 仍然 idle，后续 prompt 按约定不会被取消。

## Verification

生产修复前，`pnpm_config_verify_deps_before_run=false pnpm exec vitest run packages/goal/goal-round-driver/tests/goal-round-driver.spec.ts --reporter=verbose` 完成 40 个用例后保持活动且没有摘要。修复后，快速失败 teardown 回归测试和完整文件都能结束。最终聚焦运行报告为 `Test Files 1 passed (1)`、`Tests 57 passed (57)`，耗时 29.34 秒。取消回退 fixture 在 `agent/inbox/claimed`（预订拥有权边界）观察取消时通过。

## Decision

现在只有在之前的 `drive` 留下待处理请求时，`requestDrive` 才等待一次 `setTimeout(0)` 事件循环。这样取消和 dispose 可以继续运行，同时保留现有的请求合并循环和权限 fence。回归测试在脚本提供方持续失败时安排 `driver.dispose()`。取消回退测试现在在 `agent/inbox/claimed` 处取消；生产取消语义未改变。

## Consequences

每个合并的 recovery 请求最多增加一个事件循环轮次的延迟。该让步是有条件的，不改变 goal revision、round 上限、terminal mission fence、取消原因或 wake 选择。验证覆盖完整 goal-round driver 文件；更广泛的包级验证和 live host 行为仍属于独立证据层级。

## Alternatives considered

**每次 drive 前都让步。** 初始请求不需要额外的事件循环轮次，因此拒绝此方案。仅在已运行的处理轮次请求更多工作时让步。

**每次提供方失败都解除激活。** 可恢复失败仍保留已授权目标的继续策略，因此拒绝此方案。协作调度允许取消和释放继续运行，而不移除该权限。

## Testing

`$env:pnpm_config_verify_deps_before_run='false'; pnpm exec vitest run packages/goal/goal-round-driver/tests/goal-round-driver.spec.ts --reporter=verbose`

结果：`57 passed (57)`。
