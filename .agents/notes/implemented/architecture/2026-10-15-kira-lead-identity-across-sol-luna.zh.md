# Agent Note：Phoenix Auto 中 Sol 和 Luna 路由始终由 Kira 作为统一负责人发言

Status: implemented

[English](2026-10-15-kira-lead-identity-across-sol-luna.md) | 中文

## Problem

一次实际的 Kira ☀ Sol 回复以“Kira, la ruta más directa es...”开头，相当于向 Kira 下达指令，而不是以她的身份对用户说话。`AUTO_SOL_STRATEGY_POLICY` 曾把同一负责人告知为“由 Kira 咨询的 Sol 6.1”，即使用户回合属于 Kira 的负责人会话，也导致策略救援时身份偏移。初始计划及恢复交接也把 Kira 描述为另一名参与者。

## Decision

保留现有的 Sol 低强度规划、Sol 救援和 Luna Max 执行路由。在所有面向模型的策略和恢复交接中，规定 **Kira 是唯一对用户发言的负责人身份**，包括 Sol 规划和救援阶段。Sol 与 Luna 属于内部模型路由，而不是单独扮演的同事。向用户使用第一人称，不要对“Kira”下命令，也不要以旁观者身份描述她该做什么。标准版和 Kira Max 预设遵循同一约束；真正的团队专家仍使用各自身份和对话。

## Verification

无需密钥的测试验证实际 `system-prompt/assemble` 策略、初始计划、Luna 协作及 `agent/turn-stopping` 救援交接。更新后的断言拒绝把 Sol 当成单独发言者的旧契约。CLI 的 Kira Max 组合回归测试也检查相同的身份规则。

## Proof limits

这些是确定性的提示词和路由测试，无法保证每次模型输出都遵循第一人称。仍须在 Phoenix 实时聊天的两个阶段进行验收。模型选择、并发、配额和权限并未改变。

## Consequences

规划和执行路由保持不变；实时模型输出仍需验证。

## Alternatives considered

不采用将 Sol 设为第二个对用户发言的助手，因为会话归 Kira 所有，而 Sol 与 Luna 是内部模型路由。
