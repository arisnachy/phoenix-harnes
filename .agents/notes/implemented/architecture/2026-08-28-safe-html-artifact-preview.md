# Agent Note: safe visual HTML artifact previews

Status: implemented

English | [中文](2026-08-28-safe-html-artifact-preview.zh.md)

## Decision

The workspace artifact preview renders string `text/html` results in an iframe with an empty sandbox. The frame has no script, form, same-origin, or referrer permissions; non-HTML artifacts keep the existing escaped text/JSON path and declarative UI continues through its allowlisted node renderer.

## Verification

The focused client artifact-preview test passes and the `@deepseek-ai/dsh-client-ui-workspace` client typecheck passes. The preview remains presentation-only and does not add an execution or connector authority.
