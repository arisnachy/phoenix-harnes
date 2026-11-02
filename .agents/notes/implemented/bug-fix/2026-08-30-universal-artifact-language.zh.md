# Agent Note: 通用工件的显式语言

Status: implemented

[English](2026-08-30-universal-artifact-language.md) | 中文

## Problem

通用工件规范化器使用了优先级错误的条件表达式，因此像 `javascript` 这样的显式语言可能被当作 MIME 匹配推断，并被错误分类为 Python。sandbox 执行结果还只保存在 React 组件中，刷新后会丢失。

## Decision

先使用显式语言元数据；只有在元数据缺失时才从 MIME 类型推断语言。推断范围限定为已支持的 Python、JavaScript、TypeScript 和 CSS 渲染器。每次结构化执行结果都作为 `hardness/artifact` 会话事件追加，并用工件与来源 tool call 标识关联，使会话重新打开后可以重放最新结果。

## Consequences

代码工件会保留生产者选择的语言，而只有 MIME 信息的工件仍保持确定性的语法分类。成功和失败的 runtime 结果都会持久化并可重放；执行事件不会重复加入源代码或凭据，因为原始工件事件已经携带源代码。

## Alternatives considered

仅将执行结果保存在 React 组件中会在重新加载时丢失，因此选择 session event 作为持久化来源。根据 MIME 推断所有语言会覆盖生产者明确提供的元数据，因此推断仅作为没有显式语言时的后备方案。

## Testing

`packages/client/ui-conversation/tests/universal-artifact-surface.client.spec.tsx` 覆盖显式 JavaScript 元数据，`hardness-artifact-node.client.spec.ts` 覆盖重放；聚焦工件/runtime 测试通过 11 个测试。adapter 与 UI-conversation 包的 TypeScript 检查通过。
