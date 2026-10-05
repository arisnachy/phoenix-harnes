# Agent Note: 选定 Codex 规划与 Luna 执行

Status: implemented

[English](2026-10-04-codex-selected-planner-handoff.md) | 中文

## Problem

Phoenix 的具体 Codex handoff 仅将 Sol、Astra、Terra 识别为规划模型，并按其代际推导旧 Luna worker。其他 Codex 选择不会交接执行，也不会救援停滞的 worker。独立的 medium 推理采集覆盖还会替换用户明确选定的 Luna 规划推理强度。

## Decision

可显式启用的 `defaultExecutionHandoff` 接受所有具体 OpenAI Codex 选择。选定模型负责首个实质步骤，并在重复失败或新 Team blocker 出现时救援；执行使用当前的 `gpt-6-luna`，推理强度为 Max。首个实质步骤保留选定推理强度，同时遵循现有 GPT-6 Luna Max 规则。低成本会话路径保持不变。

调用方必须显式选择 handoff。未传入它的直接消费者保留选定路由；其他 provider 使用其选定模型完成规划和执行。Phoenix Orquesta 保留独立的自动 Sol 规划与 Luna 执行策略。真实 Team 创建和队友接纳仍由 Team composition 及其工具负责。

选择器意图存储在模型不可见的 `agent/model-selection` 事件中，与如实记录实际执行模型的请求头分离。读取时必须识别此事件，因为丢失它会改变后续模型和成本决策。明确且已接受的选择变化会追加偏好；首个分派请求仅在不存在偏好时捕获默认值，从而保留空白会话的默认值更新，并避免旧组装请求覆盖更新的明确选择。恢复后的会话因此保留原始规划模型或合成路由，而不会将最后一次 Luna 执行请求头视为新选择。Web 选择器在 flush 新偏好时保留旧的实时路由，仅在该持久化屏障成功后确认新选择。写入失败时会追加补偿偏好，保留原有的 default/explicit 来源及旧实时路由。如果补偿 flush 也失败，internal 错误会明确说明持久存储状态不确定，而不会将其误报为模型可用性问题。

现有 Team worker 在唤醒邮箱投递和定向用户回复时，根据 lead 最新的持久化选择器偏好刷新下一请求路由。Codex worker 使用 Luna Max 执行路由；其他 provider 保留所选 provider 和模型。continuation owner 持久化子 agent 的路由，并在请求组装时解析它，因为后续循环步骤可能复用先前的执行请求头。冷激活会将该持久化路由恢复到 AgentOptions 和请求配置。未提供显式路由的普通 subagent followup 保留子 agent 自己的路由。安全边界用户投递会让进行中的操作先完成，再由刷新的路由处理回复。

## Alternatives considered

**只识别指定 premium 模型层级。** 这会让选定的 Luna 和未知 Codex 模型 id 继续处于已批准规划与救援策略之外。

**推导匹配代际的 Luna。** 这会继续使用旧 worker，而不是产品设计选定的当前 Luna Max worker。

**为所有 installer 调用方启用 handoff。** 这会改变有意在整轮使用单一模型的直接消费者。

## Consequences

选定 Codex 模型决定规划与救援质量，Phoenix 当前 Luna worker 决定执行质量。路由不增加分类器调用或额外上下文。持久会话测试还覆盖偏好恢复及组装期间的明确选择竞态。功能性请求路由测试覆盖旧 Luna、旧 Sol 和未知 Codex id 的规划、执行、停滞救援及返回执行流程。
