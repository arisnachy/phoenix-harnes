# Agent Note: HARDNESS deterministic local mission judge

Status: implemented

English | [中文](2026-09-15-hardness-deterministic-local-judge.zh.md)

## Problem

The semantic HARDNESS mission judge depends on an optional subagent provider and correctly blocks when that provider is unavailable. The mission runtime nevertheless had no judge when no subagent runtime was mounted, so a mechanically complete artifact could not reach independent verification in local or minimal deployments.

## Decision

The adapters expose `createDeterministicMissionJudge()` and the production mission runner selects it whenever no semantic subagent runtime is supplied. The local judge verifies artifact id and MIME, rendered artifact identity and kind, durable evidence, and every mandatory criterion's `TESTED` or `VERIFIED` status with non-empty evidence. It returns `needs_changes` for incomplete evidence and never treats missing evidence as a pass.

The semantic `createSubagentMissionJudge()` remains the stronger path when a subagent runtime is mounted. Provider resolution, invalid structured output, non-completed runs, and startup errors remain fail-closed as `blocked`; the local path is isolated in `mission-local-judge.ts` so it does not load the optional semantic runtime.

## Verification

The local judge's pass and incomplete-evidence cases are covered in `mission-judge.spec.ts`, and the production runner's no-subagent selection is covered in `mission-runtime.spec.ts`. The local judge smoke passes under `node --experimental-transform-types`. HARDNESS and adapter typechecks, focused test typechecks, Markdown link checks, documentation budgets, Agent Note classification, and `git diff --check` pass. Vitest remains blocked before discovery by the Windows `spawn EPERM` environment failure; a direct integration test typecheck also exposes the preexisting `src`/`lib` nominal-type mismatch in `openclaw/broker.ts`.

## Consequences

Minimal deployments can complete missions whose mechanical evidence is complete without requiring a model subagent. The local judge does not replace semantic review when that provider is available and does not claim task-specific qualitative review beyond its deterministic checks. A semantic outage still prevents semantic completion rather than silently lowering the review bar.

## Alternatives considered

**Leave missions blocked without a subagent.** Rejected because local deployments need a deterministic verification path and the absence of an optional provider should not disable artifact/evidence checks.

**Fall back to the local judge after a semantic judge fails.** Rejected because a semantic failure must remain observable and fail closed; silently lowering the review bar could accept an artifact that needs qualitative inspection.

**Keep the local judge in the semantic module.** Rejected because importing the local path would still load the optional subagent runtime and reproduce the missing-build failure.
