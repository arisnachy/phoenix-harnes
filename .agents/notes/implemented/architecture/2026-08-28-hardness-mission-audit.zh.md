# Agent Note：HARDNESS mission 持久化审计

Status：implemented

[English](2026-08-28-hardness-mission-audit.md) | 中文

## 决策

live HARDNESS mission runner 会为每个 terminal protocol state 向 session 追加一个 `hardness/mission` event：`inspect`、`resolve`、`plan`、`approve`、`execute`、`verify`、`present` 和 `audit`。event 只携带 call identity、capability identity、artifact/evidence 引用、duration 与稳定的 reason code。`replayHardnessMissionAudit` 会把 append-only session log 折叠回一次调用的有序 trace。

model-facing runner 从调用方 live agent 创建 session-backed writer。standalone orchestrator 保持可选 audit writer，使隔离的 unit fixture 能在不伪造 session 的情况下测试 capability 行为。

## 安全规则

audit row 永不包含 mission arguments、rendered value、credentials 或 provider error text。missing route、denied approval、unavailable executor、failed execution、invalid artifact 或 missing renderer 都会记录 blocked protocol state 与 terminal audit row。只有在 evidence 和 terminal audit row 都记录后，成功 capability 才会 promotion。

## 验证

focused adapter tests 覆盖成功与失败 trace 的顺序、session append/replay filtering 以及既有 mission/tool integration。Windows checkout 上 HARDNESS 与 adapter typecheck 通过。生成的 persistence catalog 和 known event vocabulary 已包含 `hardness/mission`。

## 后果

session replay 可以解释 mission 为什么完成或停止，同时不暴露发送给 provider 的数据。没有 live session 的 direct runner 仍然有意保持为未记录的 test fixture；production model 与 loopback RPC path 会从其 live agent session 获得 writer。
