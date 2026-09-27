# Agent Note: HARDNESS mission telemetry

Status: implemented

[English](2026-09-15-hardness-mission-telemetry.md) | 中文

## 问题

Mission 执行需要可观察的性能与恢复指标，同时不能让 telemetry 保留 secret，也不能影响 approval、execution、verification、judge 或 terminal-state 决策。

## 决定

HARDNESS 提供从持久化 `hardness/mission` audit row 派生的无 secret mission metrics。in-memory observer 挂载到 runner，并且只在 durable audit 成功后接收相同 row。

snapshot 记录 attempts、completed 与 blocked missions、recovery attempts、每个 protocol step 的 completed/blocked 计数、非负 duration 的 count/total/maximum，以及稳定的 blocked-reason 计数。Replay 从保留的 audit row 重建等价 snapshot，不保留 arguments、credentials、provider errors 或 live runtime objects。

Telemetry 严格只用于观察。observer 失败会被隔离，不能改变 mission 决策。没有 live session 的 direct runner call 仍可提供 metrics；production audit persistence 仍由 calling session 负责。

## 考虑过的替代方案

**让 telemetry 参与 mission control。** 被拒绝，因为 observer 失败绝不能改变 approval、execution、verification、judge 或 terminal state。

**为了更丰富诊断而保留原始 mission 输入。** 被拒绝，因为 arguments、credentials、provider errors 和 live runtime objects 不属于 telemetry 契约；durable audit row 已提供足够的聚合证据。

## 影响

Phoenix 获得可 replay 的 mission 成功、阻塞、恢复和 latency 证据，并保持有界、无 secret 状态。代价是刻意的：聚合 telemetry 无法重建私有原始输入或 provider-specific failure payload。

## 验证

受控 synthetic sample 覆盖 blocked execution 后成功 presentation、replay 等价性、reset 行为和非负 duration normalization。adapter README 记录 public observer 与 replay function。
