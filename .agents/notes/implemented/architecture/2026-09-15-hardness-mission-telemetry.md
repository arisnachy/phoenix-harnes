# Agent Note: HARDNESS mission telemetry

Status: implemented

English | [中文](2026-09-15-hardness-mission-telemetry.zh.md)

## Problem

HARDNESS needed secret-free mission metrics without making telemetry part of the execution authority. Mission attempts, blocked outcomes, recovery work, protocol-step outcomes, and durations already exist as durable `hardness/mission` audit rows, but there was no bounded observer/replay projection that could summarize them without retaining arguments, credentials, provider errors, or live runtime objects.

## Decision

Expose an in-memory mission telemetry observer attached to the runner and feed it the same rows only after the durable audit succeeds. The snapshot records attempts, completed and blocked missions, recovery attempts, per-step completed/blocked counts, non-negative duration count/total/maximum, and stable blocked-reason counts.

Replay reconstructs an equivalent snapshot from retained audit rows. Direct runner calls without a live session can still expose process-local metrics, while production audit persistence remains owned by the calling session. Observer failures are contained and cannot alter approval, execution, verification, judge, or terminal-state decisions.

## Consequences

Telemetry remains observational and secret-free. Durable audit rows stay the source of replay truth, while the live observer gives operators a current bounded projection without becoming a mission dependency. Resetting the in-memory observer affects only current metrics and does not rewrite retained audit history.

The metric set is intentionally aggregate. It cannot answer questions that would require retaining raw tool arguments, credentials, provider error payloads, or other sensitive execution details.

## Alternatives considered

- Derive every metric on demand from the complete session log. Rejected because routine live observation would repeatedly rescan durable history and couple operational dashboards to persistence reads.
- Make telemetry writes part of mission completion. Rejected because an observer/backend failure must never change mission authority or terminal state.
- Retain raw arguments and provider errors for richer diagnostics. Rejected because the telemetry surface is intentionally secret-free and bounded.

## Verification

Controlled synthetic samples cover a blocked execution followed by successful presentation, replay equivalence, reset behavior, and non-negative duration normalization. The adapter README documents the public observer and replay functions.
