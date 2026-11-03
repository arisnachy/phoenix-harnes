# Agent Note: Code SDK examples are literal prompt text

Status: implemented

English | [中文](2026-10-16-code-sdk-double-brace-template-interpolation.zh.md)

## Problem

After enabling scoped Code Mode in the Kira Max preset, OpenRouter model requests failed before the tool call with `unknown prompt variable "{{name}}" in section "tools:sdk"`. The generated TypeScript SDK includes tool documentation and schemas contributed by arbitrary tools; template-looking text such as `{{name}}` there is documentation, not a Phoenix prompt variable. SystemPrompt's section renderer interpolated every section unconditionally, so it threw even though the only registered variables were `provider`, `model`, and `cwd`.

## Decision

Add optional `interpolateVariables` to `PromptSection` and `AssembledSection` with the same default-true behavior already supported for dynamic contexts. Assembly preserves an explicitly false flag, and `renderPrompt` bypasses strict interpolation for that one section. The tools registry sets `interpolateVariables: false` for only `tools:sdk`; it keeps generated source, braces and arbitrary schema descriptions verbatim. Persona, harness identity, tools guidance and all other sections retain the strict unknown-variable check.

## Alternatives considered

**Declare a fake `name` variable.** It changes the content of tool descriptions and cannot enumerate arbitrary future placeholders.

**Strip or rewrite `{{...}}` from SDK text.** This corrupts examples, and may silently alter useful tool documentation.

**Make every prompt section literal.** This would break legitimate `{{provider}}`, `{{model}}`, `{{cwd}}` rendering and weaken prompt diagnostics.

**Disable Code Mode on OpenRouter.** The bug occurs during prompt assembly regardless of model provider and is better fixed at the prompt boundary.

## Consequences

Kira can continue to use scoped `run_code` without a template collision in the generated SDK, including OpenRouter and other providers. The actual model may still fail on a different backend issue; this specifically addresses the prompt variable error. No permissions, tool dispatch or model routes change.

## Testing

System-prompt regression checks that a literal SDK section preserves unregistered double-brace markers while a regular section still throws for an unknown marker and the persona still interpolates a registered one. Code Mode integration tests render an actual generated SDK in both `code` and `both`, with `{{name}}` in a tool and parameter description. The host/client build and other CI gates remain required before Windows activation.
