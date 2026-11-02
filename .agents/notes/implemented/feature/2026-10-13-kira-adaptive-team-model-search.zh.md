# Agent Note: Kira 自适应团队容量与可搜索模型列表

Status: implemented

[English](2026-10-13-kira-adaptive-team-model-search.md) | 中文

## Problem

原来的 Team 运行时最多同时接受两名专家，部分已保存配置却要求三名专家。模型目录包含大量条目，需要逐一展开供应商并滚动查找。与模型有关的规划和故障升级指令也可能被误解为允许擅自切换供应商或伪造团队对话。

## Decision

`packages/subagent/agent-team/src/index.ts` 允许 Kira 作为负责人同时拥有一至三名专家，默认并发上限为三。上限不是配额：简单请求无需团队；独立委派通常用一名专家；两个真正独立的工作面可用两名；仅当存在三个独立范围时才用三名。

`packages/subagent/tool-agent-team/src/index.ts` 使用真实、定向、带证据的团队消息。Fénix Eclipse 用 Sol 规划和处理真实阻碍，由 Luna Max 执行；用户明确选择的其他 Codex 模型继续承担 Kira 的规划与升级，专家使用 Luna Max；Codex 之外，专家严格继承当前供应商与模型。`packages/core/agent/src/model-selection.ts` 中的 Phoenix Auto 路由在 Sol xhigh 首轮规划后，仍让 Kira 使用当前配置的 Sol high 负责协调；只有遇到真实阻碍才暂时提升为 Sol xhigh。Luna Max 专用于独立队友执行。闲聊继续使用原有的低延迟 Luna 路径。不可编造消息、切换供应商或虚构救援调用。

`packages/client/ui-model-selection/src/client/ModelSelect.tsx` 在供应商分组之上新增本地搜索。它匹配供应商名称、模型名称、标识符与显示名称；输入时自动显示匹配分组，清空后恢复原有折叠行为。搜索不请求模型，也不更改当前选择。

## Alternatives considered

**总是分配三名专家。** 没有独立职责时增加成本及冲突，因此保留按复杂度分配。

**所有规划都强制使用 Sol。** 非 Eclipse 的 Codex 选项以及其他供应商必须尊重用户明确选择的模型。

**改用服务器端目录搜索。** 已加载的模型目录含有名称和标识符，本地过滤可避免额外延迟与认证。

## Consequences

Kira 加三名真实专家现在可同时工作。实际表现仍取决于可用模型与工具；普通任务不会虚构团队参与。用户可以直接搜索大量模型，同时保留现有供应商分组。测试覆盖第三名专家、第四名拒绝、供应商与模型过滤以及无匹配结果。真实认证模型的端到端表现仍需单独验证。
