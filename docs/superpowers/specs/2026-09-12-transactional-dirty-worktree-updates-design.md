# Transactional Dirty-Worktree Updates Design

## Goal
PHOENIX source checkouts on `main` or promoted `stable` must remain eligible for stable-channel updates when the live worktree contains tracked, staged, or untracked user changes. An update must either finish with those local changes restored over the promoted stable commit, or roll back to the exact pre-update HEAD and worktree state without losing user work.

## Current failure
The stable watcher currently refuses to prepare a candidate when `git status --porcelain=v1 --untracked-files=all` is non-empty. The Windows supervisor also refuses to start the watcher on a dirty checkout and refuses activation when local changes exist. These independent clean-worktree gates turn ordinary local development into a permanent update blocker and can cause repeated warning output.

## Design
Preparation and activation remain separate. The watcher may fetch, stage, build, and smoke-test the stable target while the live checkout is dirty because staging uses its own persistent worktree. A prepared candidate is tied to the live HEAD commit, not to the live worktree cleanliness; later edits in the live worktree do not invalidate the already-tested stable target.

Activation is transactional. Immediately before the live branch moves, PHOENIX records the exact porcelain status, stores tracked/staged/untracked changes in a Git stash with `--include-untracked`, and pins that stash commit under `refs/phoenix/recovery/worktree-snapshot`. PHOENIX then verifies the live worktree is clean, activates the prepared stable commit, performs the existing build/promotion and smoke checks, reapplies the saved worktree with `git stash apply --index`, verifies that the restored porcelain status matches the pre-update status, and smoke-tests the source launcher with the restored local state.

The transaction does not use `git stash pop`; the snapshot remains recoverable until restoration and verification succeed. On success PHOENIX removes only its own stash entry and recovery ref. Existing user stashes are not reordered or dropped.

## Rollback
Any activation, build, artifact-promotion, snapshot-reapply, status-verification, or restored-source smoke failure triggers rollback. PHOENIX resets the live branch to the pre-update HEAD, removes non-ignored untracked residue created by the failed activation, reapplies the pinned snapshot with `--index`, and verifies both HEAD and porcelain status against the recorded pre-update state. The recovery ref is retained whenever exact restoration cannot be proved.

A reapply conflict on the new stable target is therefore not left for the user to resolve inside a half-updated checkout. PHOENIX returns to the previous commit and restores the original local worktree instead.

## Safety constraints
- Never overwrite or discard a dirty live checkout without first creating and pinning a recoverable snapshot.
- Include untracked files, but never use `git stash --all`; ignored dependency/build trees are outside the worktree snapshot.
- Never drop a stash by positional assumption. Locate the exact snapshot commit in `git stash list` before dropping it.
- Existing `refs/phoenix/recovery/last-good` remains the committed-code recovery pointer; `refs/phoenix/recovery/worktree-snapshot` protects the uncommitted state during the transaction.
- Development branches remain protected from automatic stable activation.
- Foreign remotes, invalid prepared targets, and unrelated unmanaged histories remain fail-closed.
- `PHOENIX_UPDATE_MODE=off` and `PHOENIX_AUTO_UPDATE=0` continue to disable the watcher.

## Components
`scripts/phoenix-worktree-transaction.mjs` owns capture, exact restoration, rollback restoration, and snapshot cleanup. `scripts/phoenix-auto-update.mjs` prepares candidates even when the live worktree is dirty and uses the transaction helper for direct one-shot activation. `scripts/phoenix-activate-prepared.mjs` uses the same helper for supervised Windows activation. `scripts/phoenix-windows-supervisor.mjs` no longer treats dirtiness as a reason to suppress the watcher or restart activation.

## Verification
Keyless tests create temporary Git repositories and prove that staged, unstaged, and untracked changes survive a successful transaction with their status preserved, that a conflicting reapply rolls back to the original HEAD and worktree, and that a pre-existing user stash is preserved. Source-contract tests pin supervisor and updater integration. Existing updater self-tests and Windows supervisor tests remain part of the focused verification set.

## Bootstrap limitation
A checkout running an older updater cannot execute behavior that exists only in the new stable commit. The first transition from the old dirty-worktree blocker therefore requires one explicit safe bootstrap on that machine (snapshot local changes, move to the new stable updater, restore them). After that transition, future updates use the transactional path automatically.
