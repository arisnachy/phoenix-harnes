# Agent Note: HARDNESS mission telemetry

Status: implemented

English | [中文](2026-09-15-hardness-mission-telemetry.zh.md)

## Problem

HARDNESS needed secret-free operational metrics for durable missions without creating a second source of truth or letting telemetry change approval, execution, verification, judge, or terminal-state decisions. The retained audit rows already described the mission lifecycle, but there was no bounded in-memory projection or replay path for attempts, recovery, step outcomes, durations, and blocked reasons.

## Decision

Expose mission telemetry as an observational projection of the durable `hardness/mission` audit rows. The in-memory observer attaches to a runner and receives the same rows only after durable audit succeeds.

The snapshot records attempts, completed and blocked missions, recovery attempts, per-step completed/blocked counts, non-negative duration count/total/maximum, and stable blocked-reason counts. Replay reconstructs the equivalent snapshot from retained audit rows without retaining arguments, credentials, provider errors, or live runtime objects.

Observer failures are contained and cannot alter mission control flow. Direct runner calls without a live session may still expose in-memory metrics, while production audit persistence remains owned by the calling session.

## Consequences

Mission telemetry is reproducible from durable audit evidence and remains free of secrets and live runtime objects. Monitoring can inspect aggregate mission behavior without becoming an execution dependency. Because telemetry is deliberately observational, loss or failure of the observer can reduce visibility but cannot approve, block, retry, or complete a mission.

Controlled synthetic samples cover a blocked execution followed by successful presentation, replay equivalence, reset behavior, and non-negative duration normalization. The adapter README documents the public observer and replay functions.

## Alternatives considered

- **Maintain a separate telemetry event stream** — rejected because it could drift from the durable mission audit and create two competing histories.
- **Record full arguments, provider errors, or live objects for richer diagnostics** — rejected because those values can contain secrets, unstable runtime state, or unnecessary sensitive detail.
- **Let telemetry failures fail the mission** — rejected because observability must not become execution authority.
