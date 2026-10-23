# Agent Note: Visible Update Command Outcomes

Status: implemented

English | [中文](2026-10-23-update-console-events.zh.md)

## Problem

The update footer showed one durable status and a simulated percentage. Once the updater started a hidden Windows command or restarted its Host, the panel could not explain whether dependency installation, compilation, smoke testing, or the handoff had passed. It could show 100% before a replacement Host was healthy and could remain at “restarting” after prewarm failed.

## Decision

The trusted updater writes an append-only, bounded JSON-lines journal in the shared repository Git control directory. Its writer accepts only fixed lifecycle and process-step codes, outcomes and numeric exit codes. No raw PowerShell output, shell arguments, filesystem paths, credentials, or environment variables enter the journal. Windows supervisor preflight operations and the staging worker report actual starts, successes, and failures. When the new Host passes its own healthy checkpoint at the exact target commit, the supervisor writes the durable `updated` outcome. A prewarm exception produces a durable failure while the former Host remains available.

The existing Host Remote reads only a bounded tail of this journal and validates known step codes, outcomes, timestamps and the exact current target SHA. This extends the existing update snapshot rather than introducing another privileged route. The sidebar renders a localized, chronological execution record with real process outcomes and exit codes; a temporary connection loss is labelled reconnection rather than success or failure. The updater percentage is an approximate phase indicator, not proof of completion. A recent `updated` event stays visible briefly for inspection.

## Alternatives considered

**Stream the complete hidden PowerShell output directly to Web.** Rejected because arbitrary command output can contain secrets and local paths; a transport outage during a Host restart would also make a live-only stream lose precisely the interesting handoff events.

**Infer steps from timeouts and estimated progress percentages.** Rejected because no elapsed-time heuristic can prove that a command or replacement Host passed.

**Wait for the Host to finish the update before recording anything.** Rejected because the supervisor and worker are the authoritative process owners and can report command exits even while the Host is unavailable.

## Consequences

The user can inspect verified update stages and detect a failed process without opening a PowerShell window. A Host outage still interrupts live polling; the journal survives and reappears after connection recovery. History is intentionally bounded and does not provide raw terminal text or arbitrary program output. Underlying activation and rollback approval and sandbox policies are unchanged. Full Windows end-to-end validation remains required in addition to contract and component tests.
