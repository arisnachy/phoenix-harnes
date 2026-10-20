# Agent Note: Preserve evolution inbox history when main cannot be merged

Status: implemented

[English](2026-10-20-evolution-inbox-conflict-safety.md) | [中文](2026-10-20-evolution-inbox-conflict-safety.zh.md)

## Problem

The scheduled PHOENIX Evolution Watch checks out phoenix/evolution-inbox and merges main before observing upstream heads. The inbox has diverged substantially from main. An unresolvable merge left the watcher failing, and repeated runs could not progress. Resetting the inbox would discard its unique commits, while continuing to publish observations against a conflicted checkout would produce unreliable results.

## Decision

The refresh step now checks whether a merge succeeded. On genuine conflicts, it captures the conflicting paths and both source SHAs, aborts the merge, reuses or creates one dedicated GitHub issue, emits refresh_ready=false, and exits without changing any remote branch. The upstream observation and publication steps and the candidate job are conditional on refresh_ready=true. Operational failures with no unmerged paths still fail the job, rather than being masked as ordinary conflicts.

The successful path still merges and publishes the updated inbox only when it has new commits. Isolated Git test repositories exercise the conflict path, fast-forward success and issue deduplication.

## Alternatives considered

**Force-reset inbox to main.** Rejected because that would discard independent history without review.

**Automatically prefer main files on conflict.** Rejected because it could silently erase valuable adaptations and misrepresent the resulting source.

**Always fail the scheduled watcher on conflicts.** Rejected because recurring failures provide no durable reconciliation record and make routine monitoring noisy; the explicit issue and readiness output preserve the blocker.

## Consequences

The watcher remains intentionally paused for source observation and candidate creation until the inbox is reconciled. Its completed refresh job can report success while emitting a warning and an open issue; this is not evidence that synchronization occurred. The fix does not reconcile the existing divergent commits, does not change main or stable, and does not authorize automatic upstream promotion.
