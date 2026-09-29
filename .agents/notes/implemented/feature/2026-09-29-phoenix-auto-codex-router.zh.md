# Agent Note: Phoenix Auto Codex Router

Status: implemented

[English](2026-09-29-phoenix-auto-codex-router.md) | 中文

## Problem

当用户希望同时获得 GPT-6 的质量、速度和成本优势时，目前必须固定选择一个 OpenAI Codex 模型和推理强度。固定使用 Luna Max 很适合执行任务，但对简单回复会产生不必要的成本；固定使用 Sol 则会把规划级推理浪费在机械执行上。现有的 Sol→Luna 交接也无法在 Luna 重复同一失败策略时自动恢复。

## Decision

当 `openai-codex` 同时发布 `gpt-6-sol` 和 `gpt-6-luna` 时，在现有模型组内增加一个合成的 `Phoenix Auto` 选项。它在界面中表现为可选择的模型，但这个合成模型 id 永远不会发送给模型供应商。

Phoenix Auto 使用确定性路由，不额外调用分类模型：

- 简单对话回复使用 GPT-6 Luna Low；
- 更深入但只需回答的问题使用 GPT-6 Luna Medium；
- 可执行任务先使用一次 GPT-6 Sol Medium 做规划/诊断；
- 后续执行使用 GPT-6 Luna Max；
- 连续相同工具错误、最近三次相同工具调用或重复供应商重试会触发一次 GPT-6 Sol 救援步骤；
- 救援后立即返回 GPT-6 Luna Max；
- 同一回合再次持续卡住时，第二次 Sol 救援可以从 Medium 提升到 High。

路由器不会为每个任务创建额外的编排器或子代理。KIRA 仍然是根编排器，因此路由决策本身不消耗模型 token，也不会增加并行代理上下文。实时 Agent 路由保持在真实的 Luna worker 上，委派的工作代理不会继承合成模型 id。

## Alternatives considered

**所有回合都使用 Luna Max。** 拒绝，因为纯回复和普通对话不需要执行级推理。

**整个任务始终使用 Sol。** 拒绝，因为规划完成后，执行更适合交给更快、更便宜的 Luna。

**每个任务都创建一个监督子代理。** 拒绝，因为这会在真正开始工作前增加额外上下文、模型调用和协调成本。

**每次路由都使用 LLM 分类。** 拒绝，因为路由本身就会增加延迟和 token 消耗。

## Consequences

模型选择器现在提供一个稳定的自动路由：可以用 Sol 规划、用 Luna Max 执行，并在检测到确定性的无进展信号时自动恢复，无需用户干预。直接选择具体模型的现有行为保持不变。

对于已经运行并完成过实际请求的会话，合成选择目前只在当前进程中保持：持久化 request header 必须记录真正执行请求的供应商路由。因此 Phoenix 会把真实的 Luna Max worker 保存为部署默认值，而不会把合成 id 泄漏到 CLI/headless 入口。未来可以增加一个独立的会话级持久路由偏好事件，在不伪造 request-header 来源的前提下消除这一重启限制。
