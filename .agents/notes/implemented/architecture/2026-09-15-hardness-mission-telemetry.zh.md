# Agent Note：HARDNESS mission telemetry

Status: implemented

[English](2026-09-15-hardness-mission-telemetry.md) | 中文

## 问题

HARDNESS 需要无 secret 的 mission metrics，同时不能让 telemetry 成为执行权威。Mission attempts、blocked outcomes、recovery work、protocol-step outcomes 与 durations 已经存在于持久化 `hardness/mission` audit rows 中，但缺少一个有界 observer/replay 投影，能够汇总这些事实而不保留 arguments、credentials、provider errors 或 live runtime objects。

## 决定

在 runner 上挂载 in-memory mission telemetry observer，并且只在 durable audit 成功后把同一批 rows 送入 observer。Snapshot 记录 attempts、completed 与 blocked missions、recovery attempts、每个 step 的 completed/blocked 计数、非负 duration 的 count/total/maximum，以及稳定的 blocked-reason 计数。

Replay 从保留的 audit rows 重建等价 snapshot。没有 live session 的 direct runner call 仍可暴露 process-local metrics，而 production audit persistence 继续由 calling session 负责。Observer 失败被隔离，不能改变 approval、execution、verification、judge 或 terminal-state 决策。

## 影响

Telemetry 保持纯观察、无 secret。Durable audit rows 仍是 replay 的事实来源，而 live observer 为运维提供当前有界投影，不会成为 mission 依赖。重置 in-memory observer 只影响当前 metrics，不会改写保留的 audit 历史。

Metric 集合刻意保持聚合，因此无法回答必须保留 raw tool arguments、credentials、provider error payloads 或其他敏感执行细节的问题。

## 考虑过的替代方案

- 每次都从完整 session log 即时计算所有 metrics。拒绝，因为日常 live observation 会反复扫描持久历史，并把运维 dashboard 与 persistence reads 耦合。
- 把 telemetry 写入作为 mission completion 的一部分。拒绝，因为 observer/backend 故障绝不能改变 mission authority 或 terminal state。
- 为更丰富的诊断保留 raw arguments 与 provider errors。拒绝，因为 telemetry surface 被设计为无 secret 且有界。

## 验证

受控 synthetic sample 覆盖 blocked execution 后成功 presentation、replay 等价性、reset 行为和非负 duration normalization。Adapter README 记录 public observer 与 replay functions。
