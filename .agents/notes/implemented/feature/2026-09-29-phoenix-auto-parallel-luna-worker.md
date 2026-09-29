# Agent Note: Phoenix Auto parallel Luna worker

Status: implemented

English | [中文](2026-09-29-phoenix-auto-parallel-luna-worker.zh.md)

## Problem

Phoenix Auto already chooses GPT-6 Sol for planning or rescue and GPT-6 Luna Max for execution, but a long task can still remain unnecessarily serial when one independent branch could run at the same time. Starting extra agents unconditionally would reduce latency in some cases while increasing token use, duplicated work, and coordination overhead in many others.

## Decision

The full Phoenix presets now give the root orchestrator an explicit adaptive delegation rule. When a clearly independent branch can shorten wall-clock time, the root may use `workflow` to start normally one GPT-6 Luna Max worker while the root continues the critical path. Two workers are allowed only when two genuinely independent branches exist.

Good parallel branches include isolated research, an independent verification pass, or a bounded implementation block whose result is not required before the root can continue. Small tasks, serial dependencies, work on the same immediate edit, and checks that a local deterministic test can answer stay on the root.

Every in-process OpenAI Codex child route used by the `standard`, `code`, and `cordis` full presets is pinned to `gpt-6-luna` with `max` reasoning. The workflow engine is capped at two concurrent and two total workers per run. Direct subagent and fork routes use the same GPT-6 Luna Max worker route when the parent is on OpenAI Codex.

The planner decides whether delegation is useful because it has the task semantics. The routing layer itself does not spawn an agent blindly and does not add a separate model call just to classify parallelism.

## Alternatives considered

**Always spawn one worker for every actionable task.** Rejected because short or tightly coupled tasks would pay extra latency and tokens with no critical-path gain.

**Allow an unbounded worker pool.** Rejected because quality would become harder to coordinate and token use could grow faster than wall-clock savings.

**Use a second Sol agent as the worker.** Rejected because Sol is reserved for planning and rescue while Luna Max is the execution worker.

## Consequences

Phoenix Auto can now reduce wall-clock time on genuinely parallel work without making multi-agent execution the default. The root remains responsible for integration and final verification, while delegated Luna workers receive bounded objectives and return reusable results instead of duplicating the root's work.
