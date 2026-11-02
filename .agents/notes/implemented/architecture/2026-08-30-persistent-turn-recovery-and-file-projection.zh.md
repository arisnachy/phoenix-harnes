# Agent Note: 持久轮次恢复与文件投影

Status: implemented

English | [中文](2026-08-30-persistent-turn-recovery-and-file-projection.md)

## Problem

达到输出 token 上限的提供方轮次可能看起来像已完成的 driver 周期，而 composer 接受的持久化非图像附件可能不会进入提供方请求。

## Decision

`max-tokens` 是尝试级终止原因，不是 mission 结果。active 且 armed 的 goal 收到该原因时，round driver 会释放当前 reservation，在 session event 发布完成后持久化 retrying supervisor checkpoint，并调度下一轮有界执行。mission 保持 active，下一轮可以选择不同策略。model loop 仍保留 `max-tokens` 事件，不会分派被截断的工具调用。

pi-ai adapter 在构造请求前从持久化附件存储解析每个文件引用。类文本文件会以有界 UTF-8 文本加入，并带有稳定元数据和明确的截断标记；二进制文件会保留为带名称的描述符，不进行不安全的解码。缺失或不一致的持久化引用会明确失败，有效文件不会从 model-visible content 中消失。

面向 model 的 `hardness_run` adapter 对受治理 capability 阻塞应用相同规则。blocked 结果是非终态，并暴露 `mission_status` 与 `next_action`，同时延迟写入持久的 `WALL_PROTOCOL` 恢复指令。这会阻止 model 将失败的 tool、strategy 或 approval path 误认为 mission 已完成，也不会在 plan mode 之外触发无效的 `exit_plan_mode` 调用。

## Alternatives considered

**移除 `max-tokens`：**拒绝，因为提供方仍需要输出上限，无界响应可能在其他层被截断或消耗不可控资源。

**把 `max-tokens` 视为 mission 失败：**拒绝，因为单次未完成的 model 尝试可恢复，不得关闭持久 mission。

**不设上限地内联每个文件：**拒绝，因为任意附件可能耗尽请求内存与 context；文本投影有上限，二进制字节不被解码。

## Consequences

长任务在 token 受限的尝试之后继续执行，同时保留准确的失败原因和 checkpoint。model 会收到文本附件的名称与有界内容，以及二进制附件的持久描述符。提供方原生文件部件不属于该 adapter 的协议无关契约。

## Testing

goal driver 测试验证 token 受限轮次保持 active、持久化恢复状态并接受后续轮次。pi-ai context 测试验证文本、截断与二进制附件投影。assembled standard preset e2e 与仓库 typecheck 在变更后通过。
