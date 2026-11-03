# Agent Note: Cooperative yield for repeated goal recovery

Status: implemented

English | [中文](2026-10-14-goal-driver-cooperative-recovery-yield.zh.md)

## Problem

When a provider failure synchronously requested another goal recovery pass while the same driver task was active, `requestDrive` could consume only microtask turns. A cancellation or teardown timer then could not run. The full goal-round file stopped after 40 completed cases; the focused cancellation case also exposed a fixture that called `Agent.cancel()` during `inbox/inserted`, where the agent is idle and the following prompt is intentionally unaffected.

## Verification

Before the production change, `pnpm_config_verify_deps_before_run=false pnpm exec vitest run packages/goal/goal-round-driver/tests/goal-round-driver.spec.ts --reporter=verbose` advanced through 40 cases and remained alive without a summary. After the change, the new rapid-failure teardown regression and the complete file both finished. The final focused run reported `Test Files 1 passed (1)` and `Tests 57 passed (57)` in 29.34s. The cancellation fallback fixture passes when cancellation is observed at `agent/inbox/claimed`, the reservation ownership boundary.

## Decision

`requestDrive` now awaits one `setTimeout(0)` turn only when the preceding `drive` left another request pending. This lets cancellation and disposal progress while preserving the existing coalescing loop and authority fences. The regression schedules `driver.dispose()` while a scripted provider keeps failing. The fallback cancellation test now cancels at `agent/inbox/claimed`; production cancellation semantics are unchanged.

## Consequences

Each coalesced recovery request can add one event-loop turn of latency. The yield is conditional and does not change goal revisions, round limits, terminal mission fences, cancellation causes, or wake selection. Verification covers the complete goal-round driver file; wider package and live-host behavior remain separate evidence levels.

## Alternatives considered

**Yield before every drive.** Rejected because the initial request does not need an additional event-loop turn. Yield only when an already-running pass requests more work.

**Disarm on every provider failure.** Rejected because recoverable failures retain the authorized goal's continuation policy. Cooperative scheduling lets cancellation and disposal run without removing that authority.

## Testing

`$env:pnpm_config_verify_deps_before_run='false'; pnpm exec vitest run packages/goal/goal-round-driver/tests/goal-round-driver.spec.ts --reporter=verbose`

Result: `57 passed (57)`.
