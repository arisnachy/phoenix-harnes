# Agent Note：渲染工具生成图片，而不是 attachment JSON

Status: implemented

[English](2026-09-03-generated-image-tool-rendering.md) | 中文

## 问题

图片生成运行时已经能够持久化有效的生成图片，并返回包含文本块和持久化 `image` 块的 Tool 结果。但 Web 的通用 Tool presenter 会对所有非文本结果块执行 `JSON.stringify`，因此用户看到的是 `attachmentId`、`mediaType`、尺寸和字节数等 attachment 元数据，而不是生成的 PNG。

这是展示层缺陷，而不是图片生成失败：attachment 包已经拥有普通 assistant message 图片所使用的授权持久图片加载器和图库 renderer。

## 决策

- `resultText` 不再把 `image` 块序列化为通用 Tool 输出文本。文本块保持原样，未知的非图片块仍保留 JSON 诊断 fallback。
- `ToolCallTree` 把现有的 `renderMessageImages` 回调传入 generic Tool fallback，不改变公开的原子 `ToolCallOwnerProps` slot contract。
- `GenericToolCard` 从已完成结果中提取持久化图片块，并通过 `renderMessageImages({ align: 'start' })` 投影 attachment 引用。
- `ui-attachment` 继续单独负责图片授权、加载、图库展示和 URL 生命周期。

## 验证

`packages/client/ui-tool/tests/tool-call-tree.client.spec.tsx` 包含与生成图片结果结构一致的回归测试，并要求持久化 attachment 必须经过 conversation 图片 renderer。完整变更继续由 CI/typecheck/lint 作为合并门槛。

## 结果

通用 Tool 调用返回的生成图片会直接显示在 transcript 中，其原始 attachment 元数据不会再作为面向用户的结果文本暴露。现有专用 Tool view 继续保持 keyed replacement 行为，也不需要修改模型或运行时的图片生成协议。
