# Agent Note: Learning context safety

[English](2026-08-29-learning-context-safety.md) | 中文

Status: implemented

## Problem

自动保留的学习内容可能包含看起来像 Phoenix 提示词变量的源代码或用户数据，例如 `{{A=3;while(A!=3){...}}}`。严格的提示词渲染器不能拒绝这些证据，也不能把它们重新解释为模板。

## Decision

`PromptContext` 支持 `interpolateVariables: false`，用于必须保持字面量的已解析上下文。学习上下文消费者使用此模式，因为其记录是序列化证据，而不是 Phoenix 编写的提示词模板。普通提示词上下文默认仍使用严格变量插值，因此格式错误的部署模板仍会明确失败。

## Alternatives considered

**在序列化记忆中转义花括号。** 这会在模型收到代码和用户文本之前修改它们，并可能引入第二种转义格式。

**放宽全局提示词解析器。** 这会隐藏格式错误的部署模板，并削弱现有的明确失败约定。

## Consequences

类似代码的学习文本可以逐字节通过提示词渲染，而普通上下文保留原有验证。行为由已组装插件的回归测试覆盖；记忆仍然有界、保留来源信息且不受信任。
