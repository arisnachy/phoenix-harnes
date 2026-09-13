# Agent Note: Supervised activation of divergent prepared stable targets

Status: implemented

English | [中文](2026-09-13-prepared-divergent-activation.zh.md)

## Problem

The Windows supervisor selected the persistent staging activator for every prepared restart. That activator required the live commit to be an ancestor of the stable target, so a managed installation with unrelated release history failed after staging with `prepared target is not a fast-forward from the live checkout`.

## Decision

Prepared activation now classifies Git ancestry before mutation. Fast-forward targets use `git merge --ff-only`; older targets are rejected; unrelated targets use `git reset --hard` only when the official, clean, managed release checkout has passed the existing base, branch, remote, and staging identity checks. The previous commit is retained at both recovery refs required by the update paths.

When the target diverges, the Windows supervisor uses the live activator instead of an older staged activator. The staging worktree remains the source of the prepared candidate and client-artifact verification, while the live activator supplies the current activation policy.

## Alternatives considered

**Keep every prepared activation fast-forward-only.** Rejected because it contradicts the stable updater policy that permits realignment of a clean managed release installation.

**Always use the live activator.** Rejected because staged activators preserve compatibility when a newer prepared target changes updater helpers or client promotion logic.

**Reset without ownership and cleanliness checks.** Rejected because it could discard development history or uncommitted user work.

## Consequences

Managed installations can complete a prepared stable realignment instead of failing at the supervisor handoff. Downgrades, unmanaged divergence, changed live checkouts, non-release branches, untrusted remotes, and invalid staging remain blocked. A current checkout with local changes still requires the user to preserve or commit those changes before activation.

## Testing

`node --check` passes for the changed updater modules. The focused Vitest run for the update policy, prepared-update contract, and Windows supervisor passes with 17 tests.
