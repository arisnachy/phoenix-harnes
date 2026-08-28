# Agent Note: 安全的可视化 HTML artifact preview

Status: implemented

[English](2026-08-28-safe-html-artifact-preview.md) | 中文

## Decision

Workspace artifact preview 会在空 sandbox iframe 中渲染字符串形式的 `text/html` 结果。该 frame 不具备 script、form、same-origin 或 referrer 权限；非 HTML artifact 保持现有的转义文本／JSON 路径，声明式 UI 继续使用 allowlist node renderer。

## Verification

聚焦的 client artifact-preview 测试通过，`@deepseek-ai/dsh-client-ui-workspace` client typecheck 也通过。preview 仍只负责 presentation，不增加 execution 或 connector authority。
