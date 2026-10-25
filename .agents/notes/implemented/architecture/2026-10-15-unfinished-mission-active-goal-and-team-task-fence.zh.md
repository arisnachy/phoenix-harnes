# Agent Note：持久目标仍活跃时不得过早结束团队任务

Status: implemented

[English](2026-10-15-unfinished-mission-active-goal-and-team-task-fence.md) | 中文

## Problem

即使 Kira 仅发送中途进度报告，团队负责人也可能发出 `turn/end: completed`。旧的团队运行时据此关闭 UME、中断专家并写入终止检查点，使独立的 Goal 回合驱动器失效。第一次修复只检查 `todo/write`，但没有清单的活跃 Goal 或团队任务仍会被过早结束；后来的人类引导消息也可能掩盖之前尚未完成的清单。

## Decision

从同一负责人会话读取持久 `goal/change` 阶段、最新清单和带修订版本的 `team/task` 状态。只要其中任何一项仍有活跃工作，单个模型回合结束就不能终止团队任务。任务边界根据 `team/mission` 首次修订的记录确定，不会随着每次引导消息重置。用户明确取消仍立即终止；真正完成的工作保持一次性终止屏障。Goal 驱动器继续独占串行自动回合、有限策略切换和配额停止机制。

## Verification

纯回归样例覆盖没有清单的活跃 Goal、已有执行与检查记录后的关闭措辞、待处理及已完成的团队任务、引导消息不丢失旧清单、以及用户明确取消。在宣称部署的 Phoenix 已修复之前，仍须完成运行时集成、Windows 构建和真实模型提供商端到端验证。

## Existing sessions written by the earlier faulty version

旧版本可能在常规模型 `turn/end: completed` 时写入持久 `team/mission: partial` 检查点，阻止升级后的活跃 Goal 唤醒。新的 Goal 屏障只允许这种旧组合继续恢复：最后回合已经完成，但最新 Goal 快照仍活跃。它**不会**重建已终止的 UME 团队、复活旧子任务，也不会绕过明确取消、已验证完成或提供商阻断。Host 重启后，常规 Goal 驱动器可重新启动并单独继续。

## Consequences

用户明确取消和真正完成的工作仍属于终止条件。

## Alternatives considered

不采用每次模型回合完成就关闭团队任务的方案，因为它会中断仍未完成的 Goal 和团队任务。
