# Agent Note: Phoenix Auto-Continue for short-output LLM routes

Status: implemented

English | [中文](2026-10-22-phoenix-auto-continue.zh.md)

## Problem

A model that finishes with `length` produces a durable assistant prefix, but the agent loop previously ended the turn with `max-tokens`, requiring the person to type “continue” for lengthy code, report, or research generation. The normal max-steps checkpoint is unrelated and does not solve output truncation.

## Decision

Continue genuine output-limit finishes at the model step boundary, preserving the partial assistant message and injecting a normal logged plugin message. Limit the continuation budget to three per human request by default, across internal turn checkpoints and restored sessions. Stop when the output repeats rather than spending more tokens on the same segment. A later successful continuation clears the earlier `max-tokens` turn reason; unrelated steering does not. Cancellation and user steering remain authoritative.

Only routes in `autoContinueProviders` are eligible (defaults: `openrouter`, `deepseek`, and `qwen`). Codex is always excluded at both provider and model-id level; the policy does not call models again unless they actually terminate at an output limit. Configure `autoContinueMaxSegments: 0` to disable all automatic continuation.

OpenRouter output `length` must not be misclassified as context overflow solely because the gateway's per-model output cap is below the catalog's advertised `maxTokens`. Actual context overflow checks still win.

## Verification

Focused model-loop tests cover full partial-prefix replay, Codex exclusion, duplicate-suppression, and bounded repeated truncation. Integration on the live Phoenix runtime still requires a provider-keyed OpenRouter response and the deployment's normal typecheck/snapshot gate. No call or tool execution should be claimed successful merely because the model resumed.

## Consequences

Only real output-length finishes for configured non-Codex routes qualify; resumption alone is not completion.

## Alternatives considered

Require the user to type continue after each output-length cutoff. Rejected for eligible routes because the agent can resume within a bounded segment policy.
