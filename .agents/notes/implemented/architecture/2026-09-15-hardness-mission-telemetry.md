# Agent Note: HARDNESS mission telemetry

Status: implemented

English | [中文](2026-09-15-hardness-mission-telemetry.zh.md)

## Problem

Mission execution needed observable performance and recovery metrics without letting telemetry retain secrets or influence approval, execution, verification, judge, or terminal-state decisions.

## Decision

HARDNESS exposes secret-free mission metrics derived from durable `hardness/mission` audit rows. The in-memory observer attaches to a runner and receives the same rows only after durable audit succeeds.

The snapshot records attempts, completed and blocked missions, recovery attempts, per-step completed/blocked counts, non-negative duration count/total/maximum, and stable blocked-reason counts. Replay reconstructs an equivalent snapshot from retained audit rows without retaining arguments, credentials, provider errors, or live runtime objects.

Telemetry is strictly observational. Observer failure is contained and cannot change mission decisions. Direct runner calls without a live session still expose metrics, while production audit persistence remains owned by the calling session.

## Alternatives considered

**Let telemetry participate in mission control.** Rejected because an observer failure must never alter approval, execution, verification, judging, or terminal state.

**Retain raw mission inputs for richer diagnostics.** Rejected because arguments, credentials, provider errors, and live runtime objects are outside the telemetry contract; durable audit rows already provide sufficient aggregate evidence.

## Consequences

Phoenix gains replayable mission-level success, blocking, recovery, and latency evidence with bounded, secret-free state. The trade-off is deliberate: aggregate telemetry cannot reconstruct private raw inputs or provider-specific failure payloads.

## Verification

Controlled synthetic samples cover a blocked execution followed by a successful presentation, replay equivalence, reset behavior, and non-negative duration normalization. The adapter README documents the public observer and replay functions.
