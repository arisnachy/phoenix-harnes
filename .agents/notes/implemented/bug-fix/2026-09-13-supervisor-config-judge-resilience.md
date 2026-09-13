# Agent Note: Keep PHOENIX recoverable across model-driven restart and configuration repair

Status: implemented

English | [中文](2026-09-13-supervisor-config-judge-resilience.zh.md)

## Problem

A model could stop the Web Host while trying to restart PHOENIX, leaving no surviving process to relaunch it. A malformed profile or plugin configuration could also become visible only after shutdown, turning an attempted repair into a boot failure. Separately, a fresh completion Judge received the original objective and current gate evidence but not the findings and required repairs issued by earlier Judge rounds.

## Decision

`scripts/phoenix-windows-supervisor.mjs` remains outside the Web Host and becomes the owner of ordinary restart recovery as well as staged-update restart. A model or operator uses `scripts/phoenix-supervisor-control.mjs`; that command first runs `scripts/phoenix-config-preflight.mjs`, which composes the effective Web profile and starts an isolated second Host on port `0` with browser opening and auto-update disabled. A restart request is published only after that isolated Host announces readiness. The supervisor performs an additional boot-free profile composition check before terminating the live Host.

A Host whose configuration fingerprint remains stable through the health window records a last-known-good snapshot of the user-owned Web profile and enabled patch configuration. If the next Host exits before the health window, the supervisor restores that snapshot once and relaunches. An unexpected Host exit without a supervisor stop request also receives one bounded relaunch, so a direct model kill does not immediately strand the harness.

`packages/goal/tool-goal/src/judge.ts` reconstructs bounded review history for the exact goal id and revision from durable `goal/judge`, `goal/completion-gate`, and `goal/false-pass` events. The fresh Judge sees prior verdict summaries, findings, required changes, executable evidence, and the original objective, and must verify that earlier required repairs were addressed before returning `pass`.

## Alternatives considered

**Let the Host restart itself.** Rejected because the process that must perform relaunch cannot be the same process being terminated.

**Validate only YAML/JSON syntax.** Rejected because a syntactically valid plugin tree can still fail during activation. The safe control path therefore requires an isolated real Host startup before shutdown.

**Automatically reset repository source after a failed boot.** Rejected because source edits can be intentional user work. Recovery is limited to the user-owned runtime configuration snapshot; repository changes remain available for diagnosis and repair.

**Give every Judge only the current attempt.** Rejected because repair requirements can disappear across rounds even though they remain part of the unresolved mission.

## Consequences

Model-driven lifecycle work is fail-closed before shutdown: failed preflight leaves the current Host alive so the model can inspect the error and repair it. A configuration that passes preflight but still fails immediately after restart can roll back to the last-known-good runtime configuration. Direct Host termination is no longer a single-point failure because the external supervisor remains alive for a bounded recovery attempt. Completion review remains anchored to the original request and accumulated repair history instead of only the latest model report.

## Testing

`scripts/phoenix-supervisor-recovery.spec.ts` covers supervisor ownership, independent preflight, isolated Host startup, last-known-good recovery, and the safe control entry point. `packages/goal/tool-goal/tests/judge-history.spec.ts` proves that a later Judge receives the original objective plus prior summary, findings, and required changes. Existing supervisor and Judge suites continue to cover staged update restart, dirty-checkout protection, executable completion gates, and fail-closed review behavior.
