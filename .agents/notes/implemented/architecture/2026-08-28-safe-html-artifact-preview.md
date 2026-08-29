# Agent Note: safe visual HTML artifact previews

Status: implemented

English | [中文](2026-08-28-safe-html-artifact-preview.zh.md)

## Problem

The workspace artifact preview treated HTML output as ordinary text, so document-producing capabilities could not provide a useful visual result while preserving the preview's presentation-only authority.

## Decision

The workspace artifact preview renders string `text/html` results in an iframe with an empty sandbox. The frame has no script, form, same-origin, or referrer permissions; non-HTML artifacts keep the existing escaped text/JSON path and declarative UI continues through its allowlisted node renderer.

## Verification

The focused client artifact-preview test passes and the `@deepseek-ai/dsh-client-ui-workspace` client typecheck passes. The preview remains presentation-only and does not add an execution or connector authority.

## Consequences

String HTML artifacts are visually useful in the workspace while scripts, forms, same-origin access, and referrers remain disabled by the iframe sandbox. Non-HTML and declarative artifacts retain their previous renderers.

## Alternatives considered

Rendering HTML directly in the application document or granting iframe permissions would increase document fidelity at the cost of expanding the preview's execution and data-access authority.
