# PHOENIX 认知运行时基础

[English](2026-09-12-cognitive-runtime-foundation-design.md) | 中文

## 状态

这是面向人类认知的认知运行时基础切片，已经批准。本文描述的是确定性投影，不是意识，也不是自主权威。

## 目标

通过从现有的、带来源信息的认知记忆日志派生注意力、工作记忆和全局工作区，为每个活动会话提供可重放的认知状态。

该切片必须让 PHOENIX 能检查当前焦点和有界上下文，同时不创建第二个会话日志、不改变权限，也不让模型自行报告完成。

## 范围

改动在 `packages/session/cognitive-runtime` 创建 `@phoenix-ai/dsh-cognitive-runtime`，并在 `session-learning` 之后将其只读服务挂载到基础组合包。

服务观察已有的会话生命周期和持久会话事件。它只针对与认知相关的事件刷新，并从 `ctx.learningMemory` 读取有界的项目范围记录。对于相同的会话日志和配置，其公开快照是确定性的。

第一阶段包含：

- `CognitiveState`，包括会话身份、项目身份、观测序号、候选数量、焦点、活动项目、后台项目和受预算抑制的项目。
- `Attention`，使用经过校验的配置权重对重要性、置信度、新近度、紧迫性、目标相关性和新颖性进行纯函数评分。
- `WorkingMemory`，使用一个焦点项目、活动列表、后台列表和抑制列表进行纯函数有界分区。
- `GlobalWorkspace`，由所选候选构造的不可变快照。
- `CognitiveRuntimeService`，作为每个会话快照和刷新生命周期的 Cordis 所有者。
- 包不变量、聚焦单元测试、基础组合包覆盖和包文档。

第一阶段明确排除模型提示注入、工具、UI、RPC、新持久事件类型、因果学习、心理模拟、可塑性、调度器唤醒，以及对 auth、credentials、approval、permissions 或 `agent-loop` 的修改。

## 现有权威

会话事件日志仍是持久事实的规范来源。`session-learning` 仍拥有认知记忆记录和来源信息。`goal`、`plan`、`interaction`、`guard`、`jobs` 和 `schedule` 仍是各自的权威；本包只消费它们已经记录的观察结果。

不需要新增 `SessionEventMap` 成员。重启会通过重放现有会话日志并重建 `session-learning` 记录来恢复相同快照。快照是投影，永远不会替代规范事件。

## 数据流

```text
session/created or relevant session/event
    -> CognitiveRuntimeService refresh queue
    -> learningMemory.ready()
    -> bounded session/project cognitive records
    -> Attention.score()
    -> WorkingMemory.partition()
    -> GlobalWorkspace.snapshot()
    -> ctx.cognitiveRuntime.get(sessionId)
```

服务忽略流式 `assistant/chunk` 事件以及不会改变第一阶段有界认知视图的其他事件。刷新在每个服务生命周期内串行执行；刷新失败会被捕获并记录，不会破坏会话事件发布方。

## 状态和评分

所有输出字段都是脱离引用的不可变数据。服务不会使用 `Date.now()`、随机标识符、进程顺序或外部状态对候选排序。新近度根据观测记录持久化的 `occurredAt` 值归一化。平局依次使用 `eventSeq`、来源 URI 和记录 id 打破。

注意力信号只从持久化记录字段派生：

- `importance` 使用记录重要性。
- `confidence` 使用记录置信度。
- `recency` 使用持久化发生时间范围。
- `urgency` 对 pending 和 error 记录为高，对其他记录为低。
- `goalRelevance` 对 mission、pending 或 prospective 记录为高。
- `novelty` 随持久化频率增加而降低。

配置的加权和按配置权重之和归一化。配置会校验有界的正列表大小、有限的非负权重以及正的权重总和。固定上限保护记忆和提示消费者不被无界记录影响；部署默认值仍可通过 Cordis 配置调整。

`WorkingMemory.partition()` 选择分数最高的候选作为焦点，然后填充活动和后台预算。超出预算的候选会标记为 budget-suppressed；这不是权限或安全抑制决策。forgotten、superseded 和 obsolete 记录会从活动候选集中排除。

## 服务契约

`ctx.cognitiveRuntime` 提供：

- `get(sessionId)` 返回脱离引用的快照；如果尚未观察到该会话则返回 `undefined`。
- `refresh(sessionId)` 在调用方改变会话状态后执行一次明确的有界刷新。
- `ready()` 作为队列刷新完成的生命周期屏障。
- `config` 作为解析后的只读评分和预算配置。

在这一阶段，该服务不是远程 Typert 权威。它没有写方法、动作执行或权限效果。未来面向模型的消费者必须将快照作为不可信上下文渲染，并在加入 profile 前通过现有的 agent／session 机制记录任何被接纳的上下文。

## 失败处理

无效配置会在服务构造期间失败。缺失的会话 id 返回 `undefined`。学习记忆加载或刷新失败时会记录日志，并保留上一次成功快照。监听器不会把异常抛回 `session/event`；队列会记录失败，并继续为后续事件提供服务。

## 测试

包测试覆盖确定性评分、平局处理、紧迫性和目标相关性、有界分区、抑制语义、无效配置、刷新／重载重建、重复事件传递和失败保留。基础组合包测试证明包已声明，并且挂载在 `session-learning` 之后。

第一阶段没有模型可见输出，因此不增加 transcript 快照。未来的上下文消费者必须先提供基于 Loader 的无密钥快照，之后才能为 profile 启用。

## 延后阶段

下一组独立阶段包括可选的模型上下文消费者、自身／世界模型、预测误差、执行控制、与现有审批的抑制集成、巩固和观察者 UI。每个阶段在实现前都必须声明持久状态、重放契约、权威所有者和证据层级。
