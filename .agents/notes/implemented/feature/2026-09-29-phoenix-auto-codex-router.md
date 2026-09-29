# Agent Note: Phoenix Auto Codex Router

Status: implemented

English | [中文](2026-09-29-phoenix-auto-codex-router.zh.md)

## Problem

A user who wants the best balance of GPT-6 quality, latency, and cost currently has to choose one fixed OpenAI Codex model and reasoning effort. A fixed Luna Max route is excellent for execution but unnecessarily expensive for simple replies, while a fixed Sol route spends planner-class inference on mechanical execution. The existing Sol-to-Luna handoff also has no automatic recovery path when Luna repeats the same failing strategy.

## Decision

Expose a synthetic `Phoenix Auto` row inside the existing `openai-codex` model group whenever both `gpt-6.1-sol` and `gpt-6-luna` are advertised. It behaves like a selectable model in the UI but is never sent to the provider as a model id.

Phoenix Auto routes deterministically, without an extra classifier model call:

- simple conversational replies use GPT-6 Luna at Low;
- deeper answer-only prompts use GPT-6 Luna at Medium;
- actionable tasks start with one GPT-6.1 Sol Medium planning/diagnosis step;
- subsequent execution uses GPT-6 Luna Max;
- repeated identical tool failures, three repeated identical tool calls, or repeated provider retries trigger one GPT-6.1 Sol rescue step;
- execution returns to GPT-6 Luna Max immediately after the rescue;
- a second persistent rescue within the same turn may raise Sol from Medium to High.

The router does not create an extra orchestrator or subagent. KIRA remains the root orchestrator, so routing itself costs zero model tokens and adds no parallel-agent context. The live Agent route stays on the real Luna worker so delegated workers never inherit the synthetic model id.

## Alternatives considered

**Run Luna Max for every turn.** Rejected because answer-only and conversational turns do not need execution-grade reasoning.

**Keep Sol active for the whole task.** Rejected because execution is better assigned to the faster, cheaper Luna worker after planning.

**Spawn a supervisor subagent for every task.** Rejected because that adds another context, model call, and coordination cost before useful work begins.

**Use an LLM to classify every routing decision.** Rejected because the router itself would then consume latency and tokens.

## Consequences

The selector now offers one stable automatic route that can plan with Sol, execute with Luna Max, and recover from deterministic no-progress signals without user intervention. Existing direct model selections keep their previous behavior.

The synthetic selection is process-local for an already-running session after its first routed request: durable request headers intentionally record the real provider route that executed the request. Phoenix therefore saves the real Luna Max worker as the deployment default instead of leaking the synthetic id into CLI/headless entry points. A future per-session durable routing-preference event can remove this restart limitation without falsifying request-header provenance.
