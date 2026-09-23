# Agent Note: HARDNESS mission telemetry

Status: implemented

[English](2026-09-15-hardness-mission-telemetry.md) | 中文

## 问题

HARDNESS 需要从持久化 mission 记录得到不含 secret 的运行指标，同时不能创建第二个事实来源，也不能让 telemetry 改变 approval、execution、verification、judge 或 terminal-state 决策。现有 audit row 已描述 mission 生命周期，但缺少对 attempts、recovery、step outcome、duration 与 blocked reason 的有界内存投影和 replay 路径。

## 决定

将 mission telemetry 定义为持久化 `hardness/mission` audit row 的纯观察投影。in-memory observer 挂载到 runner，并且只在 durable audit 成功后接收同一批 row。

snapshot 记录 attempts、completed 与 blocked missions、recovery attempts、每个 protocol step 的 completed/blocked 计数、非负 duration 的 count/total/maximum，以及稳定的 blocked-reason 计数。Replay 从保留的 audit row 重建等价 snapshot，不保留 arguments、credentials、provider errors 或 live runtime objects。

observer failure 被隔离，不能改变 mission control flow。没有 live session 的 direct runner call 仍可提供 in-memory metrics；production audit persistence 继续由 calling session 负责。

## 影响

Mission telemetry 可以从 durable audit evidence 重建，并且保持不含 secret 与 live runtime object。监控可以检查聚合 mission 行为而不成为执行依赖。因为 telemetry 明确定义为 observational，observer 丢失或失败只会降低可见性，不能 approve、block、retry 或 complete mission。

受控 synthetic sample 覆盖 blocked execution 后成功 presentation、replay 等价性、reset 行为和非负 duration normalization。adapter README 记录 public observer 与 replay function。

## 考虑过的替代方案

- **维护独立 telemetry event stream** — 拒绝，因为它可能与 durable mission audit 漂移并形成两个竞争历史。
- **记录完整 arguments、provider errors 或 live objects 以获得更丰富诊断** — 拒绝，因为这些值可能包含 secret、不稳定 runtime state 或不必要的敏感细节。
- **让 telemetry failure 使 mission 失败** — 拒绝，因为 observability 不应成为 execution authority。
