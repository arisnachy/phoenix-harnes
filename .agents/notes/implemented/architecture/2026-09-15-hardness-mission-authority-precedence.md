# Agent Note: HARDNESS mission authority precedence

Status: implemented

English | [中文](2026-09-15-hardness-mission-authority-precedence.zh.md)

## Problem

The durable HARDNESS mission kernel coordinated approval, goals, judging, routing, execution, and presentation, but did not record how competing decisions from those layers were resolved. A lower-authority executor or presentation result could therefore appear to override a higher-authority safety, approval, goal, or judge decision without a durable reason.

## Decision

The mission kernel owns one immutable authority order: `safety > approval > goal > judge > router > executor > presentation`. `resolveMissionAuthorityConflict()` returns the higher authority for distinct levels and returns a blocked tie for equal levels. `recordAuthorityConflict()` appends an `authority-conflict` event containing the two authorities, resolution, reason, and resulting mission status.

A higher-authority conflict records the winning authority but does not bypass the winning layer's own gate. An equal-authority conflict enters `WAITING_EXTERNAL` and remains recoverable through the existing resume path. Replay restores the conflict list and status from the durable event; it does not infer authority from event order or from a model-visible result.

The approval-denial path records an `approval` versus `executor` conflict before reporting the blocked mission. This keeps denial precedence auditable and prevents a failed or late execution result from being treated as permission to continue.

## Verification

Mission-kernel tests cover the complete precedence order, distinct-authority resolution, equal-authority blocking, durable event fields, and replay restoration. Mission-orchestrator tests cover the approval-denial conflict and blocked result. HARDNESS and adapter typechecks, syntax checks, and the native transformed kernel smoke pass; the focused Vitest runner remains environment-blocked by Windows `spawn EPERM` before test discovery.

## Consequences

Every authority dispute has a stable, replayable explanation and equal-level ambiguity fails closed instead of choosing by timing. The kernel gains a small event vocabulary and state field that consumers must preserve when serializing or replaying mission state. Authority resolution remains limited to mission protocol decisions; it does not grant permissions, execute capabilities, or replace the approval broker.

## Alternatives considered

**Use event order as precedence.** Rejected because asynchronous completion order is not policy authority and would make retries, replay, and late results nondeterministic.

**Let the executor or judge own precedence locally.** Rejected because each local owner would encode a partial order and durable sessions could disagree about the final decision.

**Block every conflict, including distinct authorities.** Rejected because a declared higher-authority decision can be recorded deterministically while retaining that authority's independent gate; only equal authority is intrinsically ambiguous.
