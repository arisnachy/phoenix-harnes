# Agent Note: Eclipse coordinator and subagent routing

Status: implemented

English | [中文](2026-10-21-eclipse-two-role-routing.zh.md)

## Problem

Eclipse exposed independent planner, coordinator and specialist choices although users needed one Kira coordinator and one subagent model. Its selector mixed unrelated providers, hid advertised reasoning levels and offered older model generations. Configuration failures could prevent saving these preferences. Execution policies also forced expensive reasoning regardless of task difficulty.

Absent nested settings objects materialized as empty objects, whose required route fields then failed validation during registration. Both model settings namespaces consequently disappeared from the Host description. Optional objects now retain an explicit undefined default, while present objects still validate their required fields.

## Decision

Expose two model and reasoning groups backed by the Codex account catalog. Keep the newest advertised GPT generation and family revision; preserve specialized account-visible model ids. Read earlier planner-only settings as coordination preferences and clear obsolete planner and specialist overrides when the editor saves. A configured coordinator serves every Kira phase; the subagent group serves delegated workers. Explicit effort selections take precedence.

Automatic reasoning uses the existing request text and execution evidence without an additional classifier request. Focused operations use high effort, complex work uses extra high, and exceptional work can use max. Routine conversation retains its fast path. Delegation starts with fresh context and bounded assignments when independent work justifies it; its use does not itself certify higher output quality.

## Consequences

Focused routing tests cover selected models, effort precedence, task effort and child dispatch. The assembled browser scenario uses a synthetic catalog with the real settings RPC and file provider to check two groups, supported reasoning choices, saving and browser reload. This validates routing behavior and persistence; it does not establish a measured token saving or provider quality benchmark.

## Alternatives considered

Hiding the planner field alone leaves its dispatch override active. A hardcoded model menu becomes stale and can advertise unavailable models. Calling a model solely to select another model adds cost and latency. Forcing max on every operation prevents the requested task-sensitive budget.
