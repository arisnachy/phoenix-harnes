# Agent Note: 安全的可视化 HTML artifact preview

Status: implemented

[English](2026-08-28-safe-html-artifact-preview.md) | 中文

## Problem

workspace artifact preview 把 HTML output 当作普通 text，因此 document-producing capability 无法提供有用的 visual result，同时保持 preview 只有 presentation authority。

## Decision

Workspace artifact preview 会在空 sandbox iframe 中渲染字符串形式的 `text/html` 结果。该 frame 不具备 script、form、same-origin 或 referrer 权限；非 HTML artifact 保持现有的转义文本／JSON 路径，声明式 UI 继续使用 allowlist node renderer。

## Verification

聚焦的 client artifact-preview 测试通过，`@deepseek-ai/dsh-client-ui-workspace` client typecheck 也通过。preview 仍只负责 presentation，不增加 execution 或 connector authority。

## Consequences

String HTML artifact 在 workspace 中可视化呈现，同时 iframe sandbox 会继续禁用 script、form、same-origin access 与 referrer。非 HTML 和 declarative artifact 保留原有 renderer。

## Alternatives considered

在 application document 中直接渲染 HTML，或向 iframe 授予权限，会以扩大 preview 的 execution 与 data-access authority 为代价提高 document fidelity。
