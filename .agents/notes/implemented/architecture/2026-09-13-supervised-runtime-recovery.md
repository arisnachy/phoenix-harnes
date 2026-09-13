# Agent Note: Keep PHOENIX recovery outside the Host process

Status: implemented

English | [中文](2026-09-13-supervised-runtime-recovery.zh.md)

## Problem

The Windows Web Host already ran below `phoenix-windows-supervisor.mjs`, but the supervisor treated an ordinary Host exit as terminal unless an auto-update restart marker existed. A model or runtime action that stopped the Host to apply a repair could therefore also end the only launch path that was expected to bring PHOENIX back. Boot-critical profile edits had a related failure mode: an invalid `package.json`, `cordis.patch.yml`, plugin composition, or generated Codex patch could be discovered only after the live Host had been stopped.

The completion Judge also started from a fresh child context on every round. The durable session contained earlier Judge findings and completion-gate evidence, but the new Judge prompt did not explicitly carry that review trail forward, so a later round could fail to enforce an unresolved correction from an earlier round.

## Decision

The Windows supervisor owns Host availability. An unexpected Host exit is restartable by default; only an operator `SIGINT` or `SIGTERM` marks the supervisor itself for shutdown. Update activation remains a separate supervised path with its existing clean-checkout and prepared-candidate validation.

Runtime restart requests use `scripts/phoenix-safe-restart.mjs`. The request is written outside the Host process, and the supervisor runs a boot-free `web --dump-config` preflight while the current Host remains alive. A failed preflight rejects the restart and returns the diagnostic to the caller without stopping the Host. A passing preflight transfers stop/start ownership to the supervisor.

`scripts/phoenix-config-guard.mjs` stores a fingerprinted, non-secret last-known-good snapshot of boot-critical profile configuration after a stable live window. If a changed configuration passes composition preflight but the relaunched Host still fails during startup, the supervisor restores that snapshot and relaunches again. Credential stores are not copied into the recovery snapshot.

The completion Judge now reconstructs a bounded history for the exact goal id and revision from prior `goal/judge` and `goal/completion-gate` events. Each fresh Judge receives the original objective, prior verdicts, findings, required changes, gate checks, evidence ledger, and artifact fingerprints, and must verify that every prior required change is actually resolved before returning `pass`.

## Invariants

The Host never owns the last process capable of restarting it. A model may stop or crash the Host without terminating the supervisor. Operator shutdown remains explicit and does not create an automatic relaunch loop.

A runtime configuration change may be edited freely, but an intentional restart is not accepted until the composed Web profile parses successfully while the previous Host is still alive. A configuration is promoted to last-known-good only after the relaunched Host remains alive through the stability window and the same boot-free preflight passes.

A Judge decision applies to the complete mission revision, not only the most recent builder turn. Unresolved findings and required changes remain review inputs until evidence proves them resolved.

## Consequences

A direct Host termination is self-healing under the persistent supervisor. The preferred intentional path is the safe-restart request because it can reject invalid configuration before downtime. A runtime failure after a syntactically valid but operationally bad configuration is recoverable once a prior last-known-good snapshot exists.

The first boot on a machine has no previous snapshot to restore. After the first stable window, subsequent boot-critical configuration changes gain rollback protection automatically.

## Testing

`scripts/phoenix-windows-supervisor.spec.ts` covers persistent Host relaunch, operator shutdown, preflight-before-stop, and last-known-good rollback requirements. `scripts/phoenix-config-guard.spec.ts` covers boot-free Web-profile validation, non-secret snapshot scope, fingerprinted restoration, and the restart request/result handshake. `packages/goal/tool-goal/tests/judge-history.spec.ts` covers propagation of the original objective, prior findings, and prior required changes into a later independent Judge round. CI supplies the Windows-native, Wine, static, coverage, snapshot, artifact, and compatibility matrix before promotion.
