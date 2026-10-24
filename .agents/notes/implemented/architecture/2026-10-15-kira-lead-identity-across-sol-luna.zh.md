# Agent Note：在 Phoenix Auto 的 Sol 和 Luna 路由中保持 Kira 的主导身份

Status: implemented

[English](2026-10-15-kira-lead-identity-across-sol-luna.md) | 中文

## Problem

Kira ☀ Sol 的一次真实回复以“Kira, la ruta más directa es...”开头，仿佛在指导 Kira，而不是以 Kira 本人的身份与用户交流。`AUTO_SOL_STRATEGY_POLICY` 甚至要求同一个 Lead 智能体扮演“由 Kira 咨询的 Sol 6.1”，尽管这轮对话仍属于 **Kira** 的主会话。这导致战略救援阶段的身份漂移。初始规划及恢复交接文本同样把 Kira 描述为另一个角色。

## Decision

保留既有精确路由：Sol 低强度规划、Sol 救援及 Luna Max 执行。在每份面向模型的策略和恢复交接说明中，明确 **Kira 是唯一对用户发言的 Lead 身份**，包括由 Sol 执行规划和救援时。Sol 和 Luna 是内部模型，而非要扮演的同事角色。与用户交流时使用第一人称；不要对“Kira，……”发号施令，也不要站在第三人称描述她应当做什么。已交付的标准人格及 Kira Max 人格都遵循同一约束。真实的 Team 专家仍保有各自的名字和对话身份。

## Verification

无密钥测试检查真实的 `system-prompt/assemble` Sol 策略、初始规划、Luna 协调和 `agent/turn-stopping` 救援交接；更新后的断言拒绝把 Sol 作为独立发言人的旧契约。CLI Kira Max 组合回归测试也验证相同的稳定身份要求。

## Proof limits

这些是确定性的提示词和路由测试，无法保证每一次模型输出都使用第一人称；仍需在两个阶段检查真实 Phoenix 聊天。模型选择路由、并发、配额和授权均未修改。

## Consequences

规划与执行路由保持不变；真实模型输出仍需验证。

## Alternatives considered

拒绝让 Sol 作为第二个助理身份发言，因为用户会话属于 Kira，而 Sol 和 Luna 只是内部路由。
