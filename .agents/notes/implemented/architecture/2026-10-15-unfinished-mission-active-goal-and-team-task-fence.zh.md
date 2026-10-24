# Agent Note：持久 Goal 尚未结束时避免过早关闭 Team

Status: implemented

[English](2026-10-15-unfinished-mission-active-goal-and-team-task-fence.md) | 中文

## Problem

即使 Kira 只发送阶段进度报告，Team Lead 仍会发出 `turn/end: completed`。此前 Team 运行时据此关闭 UME、中断专家并发布终止检查点，导致独立的 Goal 轮次驱动器失效。最初的修复只检查 `todo/write`，但没有清单的活跃 Goal 或 Team 任务仍可能触发过早关闭；之后的人类引导消息还可能掩盖旧清单中的待办事项。

## Decision

从同一个 Lead Session 读取持久的 `goal/change` 阶段、最新清单及带修订版本号的 `team/task` 状态。只要任一状态面仍显示活跃工作，模型回合就不能终止整个 Team 任务。当前任务边界以 `team/mission` 第一版收据为准，不会在每条引导消息后替换任务。用户显式取消仍立即停止。确已完成的任务保持既有的一次性终止边界；Goal 驱动器继续拥有串行自动轮次、受限策略变更和配额停止权限。

## Verification

纯回归测试现已覆盖：没有清单的活跃 Goal、在执行效果及检查收据之后出现的结束叙述、待办和已完成 Team 任务、引导消息不丢失旧清单项目，以及用户明确取消。尚须运行时集成、Windows 构建和真实模型提供商端到端测试，才能宣称已部署 Phoenix 实例修复完毕。

## Existing sessions written by the earlier faulty version

旧版本在普通模型 `turn/end: completed` 时写入的持久 `team/mission: partial` 检查点，可能阻止升级后原本活跃的 Goal 被唤醒。现在 Goal 边界只允许恢复这一特定旧组合（上一回合已完成，最新 Goal 快照仍处于活跃状态）。它**不会**恢复已终止的 UME 团队、重新激活旧子任务，也不会绕过显式取消、已验证完成或提供商阻断的 Goal。Host 重启后，常规 Goal 驱动器可以重新启动并独立继续。

## Consequences

用户显式取消及真正完成的任务仍会终止执行。

## Alternatives considered

拒绝在每个模型回合完成时直接关闭整个任务，因为这样会打断待执行的 Goal 和 Team 工作。
