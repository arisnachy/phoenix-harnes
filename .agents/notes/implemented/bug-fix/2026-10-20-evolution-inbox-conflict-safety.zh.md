# Agent Note：当 main 合并失败时保护演进收件箱历史

Status: implemented

[English](2026-10-20-evolution-inbox-conflict-safety.md) | 中文

## Problem

定时执行的 PHOENIX Evolution Watch 会检出 phoenix/evolution-inbox 并合并 main，然后观察上游仓库。该分支已经与 main 大幅分叉。合并冲突让监控反复失败；强制重置会丢失该分支的独立提交，而在冲突工作区中继续更新观察记录也不可靠。

## Decision

刷新步骤现在检查合并结果。发生实际内容冲突时，它记录冲突路径和两个源提交 SHA，撤销合并，仅创建或复用一条专门的 GitHub issue，输出 refresh_ready=false，并且不修改远端分支。仅当 refresh_ready=true 时才允许上游观察、发布及候选任务继续。如果失败却没有未合并路径，工作流仍然报错，避免掩盖其他故障。

正常路径仍按原有方式合并并推送新提交。独立的 Git 测试仓库验证冲突保护、正常快进合并和 issue 去重。

## Alternatives considered

**强制将收件箱重置到 main。** 不采用，因为会在未经审查的情况下删除独立历史。

**冲突时自动选择 main 的文件。** 不采用，因为可能悄悄覆盖有价值的改动，使结果失真。

**让定时任务每次遇到冲突都失败。** 不采用，因为持续报错没有形成可跟踪的修复任务；明确的 issue 和就绪状态能保留问题证据。

## Consequences

在人工解决历史分叉前，监控不会继续观察上游或创建候选任务。刷新步骤可能显示成功，但同时会产生警告和未解决的 issue；这不代表同步已经完成。此变更不会自行合并已有的分叉提交，不修改 main 或 stable，也不授权自动上游发布。
