# Agent Note：PHOENIX 以下游方式组合本地与免费模型通道

Status: implemented

[English](2026-08-22-phoenix-free-local-routing.md) | 中文

## 问题

PHOENIX 需要一个可用的模型平面，同时不能把 DeepSeek Harness 变成侵入式分叉，也不能让标称免费的路径消耗付费余额。日常工作应留在本地，需要更强模型的工作可以使用 OrcaRouter 的仅免费路由。所选提供商和模型必须与提示词组装及持久请求头保持一致。

## 决策

PHOENIX 作为第三个内置配置，在 `dsh-base` 和 `dsh-web-app` 之后组合。CLI 包同时作为最终 bundle 层，通过现有 `dsh-llm-pi-ai` 适配器声明两条 OpenAI 兼容路由：本地 Ollama 的 `phoenix-local/qwen3:8b`，以及 OrcaRouter 的 `phoenix-free/orcarouter/free`。Orca 路由只声明 `orcarouter/free`；不会注册 `orcarouter/auto` 或任何付费模型。

`@deepseek-ai/dsh/phoenix-router` 是 CLI 自带、建立在现有 Agent 扩展缝上的策略插件。新的用户消息或 agent relay 从 inbox 被领取时（位于提示词组装之前），它按照公开、确定性的规则选择本地或免费通道：显式前缀、输入长度、然后是不同的字面复杂度信号。它在提示词组装之前更新 `installModelSelection()`，从而让 `{{model}}`、请求头和适配器请求保持一致。工具结果和普通注入通知沿用当前任务的路由。提供商错误仍由已选适配器的重试策略管理；该插件不会执行跨提供商故障回退。

`phoenix` Agent 预设复制内置完整编码能力组合，只改变身份指导。它继续使用相同的文件、Shell、Skills、计划、目标、子代理和工作流，而不是创建并行工具栈。

## 已考虑的替代方案

- 不修改 `agent-loop`，因为任务路由可在提示词组装前使用公开的 inbox claim 和模型选择扩展缝。
- 不注册 `orcarouter/auto` 作为回退，因为它可能消耗钱包余额并破坏仅免费契约。
- 不让 OrcaRouter 分类所有请求，因为日常工作应留在本地，而且运维策略必须可检查。
- 不构建新的 OpenAI 兼容适配器，因为 `dsh-llm-pi-ai` 已支持声明式端点和模型。

## 后果

PHOENIX 现在拥有一个可运行、可无密钥测试的纵向切片，其外部成本边界由结构保证。运维者必须运行 Ollama、安装 `qwen3:8b`，并为免费通道提供 `ORCAROUTER_API_KEY`。字面分类有意比语义路由简单，并完全暴露以便调优。记忆、receipts、Forge Chamber、Evolution Mesh 和领域包仍属于后续下游工作。
