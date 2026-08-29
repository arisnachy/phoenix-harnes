# Agent Note: Durable goal supervisor checkpoints

Status: implemented

English | [中文](2026-08-29-durable-goal-supervisor.zh.md)

## Problem

Goal continuation state was persisted as goal and judge events, but a restart did not retain a bounded record of the supervisor's next action or the last queue failure. Operators could see the goal phase without a durable recovery checkpoint.

## Decision

The goal domain owns a log-only `goal/supervisor` event. The goal-round driver writes a checkpoint when it observes a goal lifecycle transition, a continuation is prepared, or queueing fails. It replays the latest checkpoint when a session starts. The checkpoint contains only the goal identity, revision, round count, bounded status/action enums, an attempt count, and a truncated error summary.

Replay restores diagnostics, not authority. Session start still disarms the process-local driver, and only the exact direct-human `update_goal resume` transition can rearm a goal. This prevents a restarted process from mutating a workspace solely because an old session was active.

## Alternatives considered

- **Persist process-local armed state and resume automatically.** Rejected because a restart must not regain workspace mutation authority without a fresh human instruction.
- **Reuse `goal/change` for supervisor status.** Rejected because supervisor checkpoints are operational diagnostics and must not alter the goal lifecycle or its compare-and-set revision.
- **Store provider error text without a bound.** Rejected because provider output can contain secrets or unbounded data; checkpoints retain only a short normalized summary.

## Consequences

Recovery tooling can show what a mission was doing and what it should do next without parsing provider output or secrets. Persistence failures disarm continuation and are visible through the existing logger. The checkpoint is append-only and survives both JSONL and SQLite session persistence.
