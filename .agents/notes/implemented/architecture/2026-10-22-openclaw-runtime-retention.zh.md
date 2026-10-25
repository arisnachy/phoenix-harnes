# Agent Note: OpenClaw 运行时保留

Status: implemented

[English](2026-10-22-openclaw-runtime-retention.md) | 中文

## 问题

OpenClaw 更新会在 `$DSH_HOME/openclaw-runtime` 下产生带版本的 runtime、隔离 Node 目录、发行归档和 npm cache。没有有界的保留机制时旧安装会不断累积，而宽泛的递归清理可能删除状态数据或跟随链接进入受监管 runtime 之外。

## 决策

脚本 [`scripts/phoenix-runtime-retention.mjs`](../../../../scripts/phoenix-runtime-retention.mjs) 只规划 `versions`、`node`、`artifacts` 以及显式请求的 `npm-cache` 子目录中的清理。active、previous 和 candidate marker 提供的 runtime、Node 和 artifact 引用都会保留；未知条目保持不变。版本和 staging 名称、Node runtime 名称以及 OpenClaw 或 Node 归档名称必须符合受管理命名规则，才会成为清理目标。

规划器把 marker 作为普通文件读取，要求引用路径为绝对路径并位于 runtime root 内；当 marker、受管理 root、候选 target 或其后代是符号链接或 Windows reparse point 时安全失败。它还检查 DSH home 的祖先目录，并要求精确的 `openclaw-runtime` 子目录名称。被阻止的计划不暴露可执行 target。应用 API 要求调用方持有共享 runtime lock，同时提供 `dryRun: false` 和 `confirm: true`；它从精确的 home 重新规划，只接受未变化的 target 集合，比较 marker revision 与保留头，并在每次删除前重新检查这些条件。Phoenix 状态、OpenClaw 状态、凭据和 marker 文件永远不会进入删除允许列表。

## Alternatives considered

**删除整个 `openclaw-runtime` 目录** 被拒绝，因为其中包含会话、配置、凭据和生命周期 marker。

**只保留 active runtime** 被拒绝，因为 rollback 和已准备的 candidate 都要求 previous 与 candidate 安装继续存在。

**枚举受管理条目时跟随链接** 被拒绝，因为 junction 或符号链接可以把递归删除重定向到隔离 runtime 之外。

**规划完成后自动执行清理** 被拒绝，因为安装生命周期所有权、共享 runtime lock 和 Phoenix 的全局 idle 证明属于调用方；该模块提供 dry-run 规划和显式确认的应用操作。

## 后果

保留操作在变更前可审查且结果确定。只有调用方声明持有共享 runtime lock 且没有 live installer 时，staging 目录与 npm-cache 才会成为目标；当其他进程拥有 cache 时，调用方可以将其排除。测试使用临时 fixture，验证 marker 保留、状态/配置/凭据保护、路径 containment、祖先保护、链接拒绝、旧计划拒绝、dry-run、显式确认以及每次删除前的重新验证。本变更不会清理真实 `$DSH_HOME` 数据。
