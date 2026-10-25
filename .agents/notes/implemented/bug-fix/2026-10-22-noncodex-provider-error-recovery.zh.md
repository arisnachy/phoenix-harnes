# Agent Note：恢复通用 pi-ai 错误而不绕过研究验证

Status: implemented

[English](2026-10-22-noncodex-provider-error-recovery.md) | 中文

## Problem

一个较小的 OpenRouter 模型调用 `phoenix_research_publish` 时只提供标题与章节。发布工具正确地拒绝在缺少真实 `report.references` 的情况下生成学术报告。之后 pi-ai 模型流以通用 `PI_AI_ERROR` 终止，而正常提供商重试策略不会重试该错误，因此用户回合终止。

## Decision

发布工具现已在大多数模型会读取的模式字段中说明参考文献的前提条件；验证器也会提供可操作的研究和引用键指导，但不会编造来源。

对于符合条件的非 OpenAI/Codex 路由和模型，pi-ai 适配器把无法进一步分类的通用错误标记为特定的瞬态 `PI_AI_TRANSIENT_ERROR`。若路由没有显式策略，常规恢复插件按现有记录的退避机制最多重试两次。原生 OpenAI、Codex 和 ChatGPT Web 路由不变；通过 OpenRouter 使用的 OpenAI/Codex 模型 ID 也排除在外。显式重试策略保持原来的语义。已知的无效请求、配额和授权失败不会转为通用重试；超过重试上限的持续故障仍须明确呈现。

## Verification

策略、流式处理和研究发布的定向测试应覆盖：缺失参考文献、带来源的契约、默认重试、显式关闭重试、网关后的 Codex 排除、通用缺失错误、无效参数、授权拒绝及终止事件传播。要确定特定 OpenRouter 流故障的真实原因，仍需有提供商密钥的实际运行时测试。必须继续执行研究来源完整性约束。

## Consequences

研究发布仍要求真实来源；非瞬态故障必须明确显示。

## Alternatives considered

拒绝不加分类地重试所有通用错误或无效提供商错误，因为授权失败、配额限制和格式错误的请求并非瞬态故障。
