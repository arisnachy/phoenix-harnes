# Agent Note: durable HARDNESS mission audit

Status: implemented

English | [中文](2026-08-28-hardness-mission-audit.zh.md)

## Decision

The live HARDNESS mission runner appends one `hardness/mission` session event for each terminal protocol state: `inspect`, `resolve`, `plan`, `approve`, `execute`, `verify`, `present`, and `audit`. The event carries only the call identity, capability identity, artifact/evidence references, duration, and stable reason codes. `replayHardnessMissionAudit` folds the append-only session log back into one call's ordered trace.

The model-facing runner creates the session-backed writer from the calling live agent. The standalone orchestrator keeps its audit writer optional so isolated unit fixtures can exercise capability behavior without fabricating a session.

## Safety rules

Audit rows never include mission arguments, rendered values, credentials, or provider error text. A missing route, denied approval, unavailable executor, failed execution, invalid artifact, or missing renderer records a blocked protocol state and a terminal audit row. A successful capability is promoted only after evidence and the terminal audit row are recorded.

## Verification

Focused adapter tests cover ordered success and failure traces, session append/replay filtering, and the existing mission/tool integration. HARDNESS and adapter typechecks pass on the Windows checkout. The generated persistence catalog and known event vocabulary include `hardness/mission`.

## Consequences

Session replay can explain why a mission completed or stopped without exposing the data sent to a provider. Direct runners without a live session remain intentionally unrecorded test fixtures; production model and loopback RPC paths receive the writer from their live agent session.
