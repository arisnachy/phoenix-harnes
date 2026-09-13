# Agent Note: Prepare stable updates without blocking dirty local checkouts

Status: implemented

English | [中文](2026-09-12-dirty-checkout-update-staging.zh.md)

## Problem

The stable watcher treated any local change as a reason to skip candidate preparation. A source checkout with active work therefore kept reporting the same available SHA while the running Host and its isolated staging path received no usable update state.

## Decision

`scripts/phoenix-auto-update.mjs` validates and builds every stable candidate in the persistent detached staging worktree even when the live checkout is dirty. `stagedCandidateValid()` checks only the prepared base and the clean staged worktree, while `preparedCandidateValid()` adds the clean-live-worktree requirement used by activation.

When local changes remain after preflight, the updater records `available` with `phase: worktree`, leaves the Host running, and explains that activation waits for a clean checkout. Live activation continues to reject a dirty checkout before any merge, reset, or artifact promotion.

## Alternatives considered

**Block before staging.** Rejected because it turns normal local development into a repeating watcher blocker and violates the isolated-preflight ownership of the update path.

**Merge or reset the live checkout while dirty.** Rejected because it could overwrite uncommitted source, generated files, or user-created paths. The clean-worktree check remains an activation invariant.

## Consequences

Stable candidates can be downloaded, built, and smoke-tested without modifying the live source checkout. A prepared candidate becomes activatable only after the live checkout is clean; until then the durable state remains informational and no restart action is offered.

## Testing

`scripts/phoenix-update-contract.spec.ts` covers isolated preparation on a dirty checkout and clean-checkout activation requirements. `node scripts/phoenix-auto-update.mjs --self-test` and `node --check scripts/phoenix-auto-update.mjs` pass.
