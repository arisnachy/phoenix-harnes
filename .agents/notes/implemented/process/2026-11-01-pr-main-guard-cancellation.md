# Agent Note: Cancel obsolete PR guards without interrupting main builds

Status: implemented

English | [中文](2026-11-01-pr-main-guard-cancellation.zh.md)

## Problem

The Windows main guard compiles and tests each pull-request SHA and each main push. Its workflow-level concurrency used `cancel-in-progress: false` for all events, so rapid successive commits from automated contributors left obsolete pull-request validations waiting behind newer commits. Those outdated runs consume hosted Windows capacity and prolong integration without providing a result for the final SHA.

## Decision

The main guard keeps its concurrency group scoped to `github.ref`, but cancels an in-progress run only for the `pull_request` event. Pushes to main and manual dispatches continue without automatic cancellation, preserving the exact SHA evidence required to release to stable. The workflow still performs the same Windows typecheck, regressions, build and native inventory on the final pull-request SHA.

The main PR CI and diagnostics already cancel superseded PR runs. This change aligns the costly Windows main guard with that existing practice, without skipping tests, changing check names, bypassing branch protection, or changing stable promotion rules.

## Alternatives considered

- **Cancel all in-progress guard runs.** This could interrupt required verification after merging to main and jeopardize the automated stable update channel.
- **Stop running the main guard on PRs.** This would eliminate useful Windows validation before merging and weaken the release contract.
- **Increase runner capacity only.** More machines do not prevent repeated work against SHAs that have already been superseded.

## Consequences

A new PR commit replaces the old run and tests only the current candidate once it executes. The last PR commit must still complete the full guard successfully before merging. Automation authors should group local edits and tests into one published commit to avoid repeated cancellation and CI churn. Existing failures in unrelated static and coverage gates remain actionable and must be repaired separately.

## Testing

The workflow regression asserts the exact event-gated cancellation expression and the existing guard coverage. GitHub Actions should show superseded PR main-guard runs as cancelled, while main-push runs still execute and enable stable verification.
