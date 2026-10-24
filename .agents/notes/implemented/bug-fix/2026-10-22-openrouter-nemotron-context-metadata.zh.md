# Agent Note：OpenRouter 上的 Nemotron 3 Nano 输入上下文被低估

Status: implemented

[English](2026-10-22-openrouter-nemotron-context-metadata.md) | 中文

## Problem

Phoenix 拒绝了 `nvidia/nemotron-3-nano-30b-a3b` 的请求，因为在预留 4,096 个安全 token 和 4,096 个输出 token 后，计算得到的安全输入预算仅为 122,880 token。这意味着解析出的模型 `contextWindow` 为 131,072，而请求估算需要 187,208 个输入 token。

## Decision

OpenRouter 官方模型页面记载这条确切路由的上下文窗口为 262,144 token：https://openrouter.ai/nvidia/nemotron-3-nano-30b-a3b

只有在官方 OpenRouter 端点的继承目录容量过时时才恢复已发布的上下文值。有效安全输入预算因此为 253,952 token，这个需要 187,208 token 的请求可以进入发送流程。

绝不能提高用户显式覆盖的上下文窗口，也不能提高实际容量可能更低的私有网关限制。不得屏蔽真实的 CONTEXT_WINDOW_EXCEEDED 故障；保留仅针对请求的目录与工具适配，以及持久化压缩恢复路径。上游模型或提供商可能实施比公共目录更严格的限制；这种情况仍属于真实、可恢复的上下文错误或阻断，不能假装执行成功。

## Regression

目录测试检查官方路由修复、非 OpenRouter 路由隔离、覆盖值优先级和 187,208-token 示例。上下文适配测试确保在所选路由容纳不下内容时不会篡改原始用户输入。

## Consequences

修正后的公共路由仍受上游真实限制和正常上下文恢复机制约束。

## Alternatives considered

拒绝一概增大所有模型的上下文窗口，包括用户覆盖值和私有网关，因为无法从公共目录推断其真实限制。
