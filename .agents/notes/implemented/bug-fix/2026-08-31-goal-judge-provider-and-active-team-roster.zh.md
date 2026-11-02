# Agent Note: 可恢复的 goal judge 与活动团队名单

Status: implemented

[English](2026-08-31-goal-judge-provider-and-active-team-roster.md) | 中文

## 问题

Goal 完成流程直接选择已配置的 `spawn` 别名。当别名缺失、部署只提供其他提供方或提供方注册表正在切换时，即使存在其他结构化审查提供方，也会返回 blocked judge 结果或 `GOAL_JUDGE_UNAVAILABLE` 工具错误。KIRA 团队停靠面板还保留已结束的 child 并显示终态 `done`，使可见名单无限增长。

## 决策

Subagent seam 现在按能力解析独立结构化审查提供方：如果已配置提供方支持结构化输出和工具过滤，就优先使用它；否则按稳定注册顺序查找已注册提供方，并优先选择不继承父级对话的提供方。Goal、Organization Forge、specialist 和 HARDNESS 审查都使用这个解析器。缺少服务或提供方暂时不可用时，返回中性的等待验证结果并保持 goal active，不降低通过条件，也不在面向模型的文本中暴露提供方内部细节。团队停靠面板只保留运行中的 child，并在每个任务标签旁显示活动模型 persona。

## 考虑过的替代方案

**配置的提供方缺失时移除 judge gate。** 否决，因为不可用的 judge 不能为未验证的交付物背书。

**始终使用第一个已注册提供方。** 否决，因为配置在提供方可用时应优先，而且继承父级上下文的提供方不适合作为独立审查的首选。

**保留全部 child 并把已结束行标记为 done。** 否决，因为用户要求的是活动名单，而不是归档；历史会话仍可通过对话和 session search 访问。

## 后果

临时提供方别名变化不再停止持久任务，也不再要求用户执行面向技术的恢复步骤。任务仍然不能在没有结构化通过 judge、现有证据和质量门禁的情况下进入 DONE。团队停靠面板变得紧凑且实时：结束的 child 会消失，活动 child 显示任务标签、agent persona 和运行状态。

## 测试

聚焦的 goal-judge 测试覆盖回退选择和没有服务时的等待结果。Goal-tool 测试覆盖没有提供方错误时保持 goal active。KIRA 团队测试覆盖移除结束 child 和显示 Luna persona。HARDNESS 使用同一解析器，并保留原有的结构化决策 fail-closed 测试。
