# Agent Note: PHOENIX composes local and free model lanes downstream

Status: implemented

English | [中文](2026-08-22-phoenix-free-local-routing.zh.md)

## Problem

PHOENIX needs a usable model plane without turning DeepSeek Harness into an invasive fork or allowing a supposedly free path to consume paid balance. Routine work should remain local, while work that benefits from a stronger model may use OrcaRouter's free-only route. The selected provider and model must remain consistent with prompt assembly and the durable request header.

## Decision

PHOENIX is a third shipped profile composed after `dsh-base` and `dsh-web-app`. The CLI package also acts as its final bundle layer and declares two hand-configured OpenAI-compatible routes through the existing `dsh-llm-pi-ai` adapter: local Ollama at `phoenix-local/qwen3:8b`, and OrcaRouter at `phoenix-free/orcarouter/free`. The Orca route names only `orcarouter/free`; neither `orcarouter/auto` nor any paid model is registered.

`@deepseek-ai/dsh/phoenix-router` is a CLI-owned policy plugin over the existing Agent seams. When a new user message or agent relay is claimed from the inbox, before prompt assembly, it chooses local or free using visible deterministic rules: explicit prefixes, input length, then distinct literal complexity signals. It updates `installModelSelection()` before prompt assembly, keeping `{{model}}`, the request header, and the adapter request aligned. Tool results and ordinary injected notices retain the current task's route. Provider errors remain governed by the selected adapter's retry policy; this plugin performs no cross-provider failure fallback.

The `phoenix` agent preset copies the shipped full coding capability composition and changes only identity guidance. It keeps the same files, shells, skills, plans, goals, subagents, and workflows rather than creating a parallel tool stack.

## Alternatives considered

- Modifying `agent-loop` was rejected because task routing can use the public inbox-claim and model-selection seams before prompt assembly.
- Registering `orcarouter/auto` as a fallback was rejected because it could spend wallet balance and would break the free-only contract.
- Letting OrcaRouter classify every request was rejected because routine work should remain local and operator policy must stay inspectable.
- Building a new OpenAI-compatible adapter was rejected because `dsh-llm-pi-ai` already supports declared endpoints and models.

## Consequences

PHOENIX now has a runnable, keyless-testable vertical slice whose external cost boundary is structural. Operators must run Ollama, install `qwen3:8b`, and provide `ORCAROUTER_API_KEY` for the free lane. Literal classification is intentionally simpler than semantic routing and is exposed for tuning. Memory, receipts, Forge Chamber, Evolution Mesh, and domain packs remain later downstream work.
