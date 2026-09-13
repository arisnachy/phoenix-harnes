# Agent Note：让 PHOENIX 在模型驱动的重启与配置修复过程中保持可恢复

Status: implemented

[English](2026-09-13-supervisor-config-judge-resilience.md) | 中文

## 问题

模型在尝试重启 PHOENIX 时可能停止 Web Host，导致没有存活的进程负责重新启动。错误的 profile 或插件配置也可能直到关机后才暴露，从而把一次修复尝试变成无法启动的问题。另一方面，新的完成 Judge 虽然会收到原始目标和当前 gate 证据，却不会收到之前 Judge 轮次已经提出的发现和必须完成的修复项。

## 决策

`scripts/phoenix-windows-supervisor.mjs` 保持在 Web Host 之外，并同时负责普通重启恢复和 staged-update 重启。模型或操作员通过 `scripts/phoenix-supervisor-control.mjs` 请求生命周期操作；该命令首先运行 `scripts/phoenix-config-preflight.mjs`，组合实际 Web profile，并在端口 `0` 上启动一个隔离的第二 Host，同时关闭浏览器打开和自动更新。只有当隔离 Host 宣布就绪后，才发布重启请求。Supervisor 在终止当前 Host 前还会再次执行无需启动应用的 profile 组合检查。

当 Host 的配置指纹在健康窗口内保持稳定时，系统会记录用户 Web profile 和已启用 patch 配置的 last-known-good 快照。如果下一次 Host 在健康窗口结束前退出，Supervisor 会恢复该快照一次并重新启动。如果 Host 在没有 Supervisor 停止请求的情况下意外退出，也会获得一次有界的重新启动机会，因此模型直接终止 Host 不再立即导致 harness 无法恢复。

`packages/goal/tool-goal/src/judge.ts` 会针对完全相同的 goal id 和 revision，从持久化的 `goal/judge`、`goal/completion-gate` 和 `goal/false-pass` 事件重建有界的审查历史。新的 Judge 可以看到之前的 verdict 摘要、发现、required changes、可执行证据以及原始目标，并且必须验证之前要求的修复已经完成，才能返回 `pass`。

## 考虑过的替代方案

**让 Host 自己重启自己。** 拒绝，因为负责重新启动的进程不能与正在被终止的进程是同一个进程。

**只验证 YAML/JSON 语法。** 拒绝，因为语法有效的插件树仍可能在激活阶段失败。因此安全控制路径要求在关闭当前 Host 之前实际启动一个隔离 Host。

**启动失败后自动重置仓库源码。** 拒绝，因为源码修改可能是用户有意进行的工作。恢复范围仅限用户拥有的运行时配置快照；仓库修改继续保留，以便诊断和修复。

**每一轮 Judge 只查看当前尝试。** 拒绝，因为跨轮次后修复要求可能被遗忘，即使它们仍然属于未完成任务的一部分。

## 后果

模型驱动的生命周期操作会在关机前 fail-closed：preflight 失败时当前 Host 继续运行，使模型可以查看错误并修复。即使某个配置通过 preflight，但重启后仍立即失败，也可以回滚到 last-known-good 运行时配置。直接终止 Host 不再是单点故障，因为外部 Supervisor 会保留一次有界恢复机会。完成审查会持续以原始请求和累积修复历史为依据，而不是只依赖模型最近一次报告。

## 测试

`scripts/phoenix-supervisor-recovery.spec.ts` 覆盖 Supervisor 所有权、独立 preflight、隔离 Host 启动、last-known-good 恢复以及安全控制入口。`packages/goal/tool-goal/tests/judge-history.spec.ts` 证明后续 Judge 会收到原始目标以及之前的摘要、发现和 required changes。现有 Supervisor 和 Judge 测试继续覆盖 staged update 重启、dirty-checkout 保护、可执行 completion gate 和 fail-closed 审查行为。
