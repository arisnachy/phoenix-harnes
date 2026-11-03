# Agent Note: Code SDK 示例作为原样提示文本处理

Status: implemented

[English](2026-10-16-code-sdk-double-brace-template-interpolation.md) | 中文

## Problem

在 Kira Max 预设中启用独立 Code Mode 后，OpenRouter 的请求在调用工具之前报错：`unknown prompt variable "{{name}}" in section "tools:sdk"`。生成的 TypeScript SDK 包含任意工具提供的说明与参数 schema，因此 `{{name}}` 等模板形式的字符只是文档示例，并非 Phoenix 提示变量。SystemPrompt 原本无条件插值所有 section，尽管已注册变量仅有 `provider`、`model` 和 `cwd`，仍会抛错。

## Decision

向 `PromptSection` 与 `AssembledSection` 增加可选的 `interpolateVariables`，默认仍为 true，与动态 context 现有功能一致。组装时保留显式的 false，`renderPrompt` 对该 section 不执行严格插值。工具注册表只将 `tools:sdk` 设为 `interpolateVariables: false`，生成代码、花括号和任意工具描述都保留原样。人格提示、系统身份和其他 section 仍执行严格的未知变量检查。

## Alternatives considered

**添加虚假的 `name` 变量。** 可能改变工具说明，并且无法预先列出未来任意占位符。

**删除或修改 SDK 内的 `{{...}}`。** 会破坏实例代码和工具文档。

**令全部提示 section 都不插值。** 将破坏合法的 `{{provider}}`、`{{model}}`、`{{cwd}}` 并削弱错误检测。

**针对 OpenRouter 禁用 Code Mode。** 这是跨提供商的提示组装错误，应该在提示边界修复。

## Consequences

Kira 可以继续使用独立的 `run_code`，生成 SDK 中的模板字符不会因插值冲突而失败，包括 OpenRouter 等提供商。这不保证其他提供商故障也被修复；这里只解决提示变量错误。不修改权限、工具执行或模型路由。

## Testing

系统提示测试确保 SDK 原样保留未注册的双花括号标记、普通 section 对未知标记仍抛错，且人格提示能够插值已注册变量。Code Mode 集成测试分别在 `code` 和 `both` 模式下渲染实际 SDK，工具和参数说明都包含 `{{name}}`。Windows 激活前仍需要主机和客户端编译及其他 CI 检查。
