# Agent Note: Exact-SHA stable promotion without forced updates

Status: implemented

English | [中文](2026-11-01-stable-exact-sha-ci-promotion.zh.md)

## Problem

Repeated PR commits trigger expensive CI runs. Passing only the Windows main guard does not prove that the complete original PR CI passed, and the stable update workflow used a force-with-lease push despite checking ancestry. A green workflow with a skipped real DeepSeek E2E job must never be treated as real API verification.

## Decision

The automatic stable publisher requires the exact current main SHA, a successful main-push guard, and an independently verified merged PR source whose head has completed all applicable PR workflows successfully. It separately checks that the real DeepSeek E2E job succeeded, rather than trusting the configuration-only workflow outcome. Missing, pending, failed or truncated API evidence fails closed.

The stable ref advances only with a normal non-forced Git push after an ancestry check. The job then re-fetches both branches and asserts that main and stable equal the exact verified SHA. Direct pushes without an associated verified PR cannot promote to stable. Existing exhaustive CI remains unchanged, and PR authors should batch fixes and reuse completed SHA-specific results rather than publishing one-comment commits repeatedly.

## Alternatives considered

- **Force-with-lease after checking ancestry.** Even when the local ancestry check succeeds, a force-capable ref update violates the no-force promotion contract.
- **Use only the main guard.** It misses unrelated static, coverage, snapshot and consumer failures from the source PR.
- **Treat the DeepSeek workflow status as sufficient.** Its configuration job can pass while the real E2E job is skipped.
- **Skip missing remote evidence.** This would convert transient API or credential failures into an unauthorized release.

## Consequences

Valid merges promote without a manual stable step after the exact main push guard finishes, while unsafe merges remain in main without being propagated to stable. The repository needs an administrative branch ruleset to prevent direct pushes to main; this fail-closed release gate cannot replace branch protection. Real E2E credentials and any failing tests must be repaired before a release can proceed.

## Testing

The Node regression suite covers valid CI evidence, wrong SHA, missing or failed workflows, pending work, skipped real E2E, and conditional non-applicable workflows. The regular static CI lane runs these tests, and the stable publisher runs them again before checking live GitHub evidence.
