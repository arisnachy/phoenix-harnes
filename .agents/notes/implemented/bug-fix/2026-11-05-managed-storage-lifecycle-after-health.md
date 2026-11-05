# Agent Note: Reclaim managed runtime and staging copies after proven release health

Status: implemented

## Problem

Windows PHOENIX isolated runtimes are full worktrees with build outputs and dependencies. At short update intervals, the active runtime, candidate, rollback copy and persistent staging tree can consume multiple GiB in `~/p`. The updater applied a per-checkout quota while the supervisor additionally enforced a global quota, allowing the watcher to start expensive preparation near the cross-checkout limit. The current checkout's staging tree was never reclaimed, even after normal shutdown and an explicit offline repair. The supervisor kept a rollback cushion after the new Host passed its health checkpoint, despite the user's default preference for freeing obsolete copies.

## Decision

- Keep active, executing and owned-by-other-checkout runtimes protected at all times. During preparation and before health confirmation, keep the existing rollback cushion.
- After the replacement Host passes the verified health checkpoint, release *inactive* versions by default. Respect an explicit `PHOENIX_UPDATE_RUNTIME_BACKUPS` preference.
- On orderly shutdown after the watcher and Host have stopped, retire the current checkout's idle stage and inactive copies. On unexpected exit, retain rollback evidence.
- An explicitly offline PowerShell repair (with confirmed no PHOENIX processes or port owner) may request stage reclamation. The supervisor still refuses a prepared or actively building stage, foreign worktrees, and a stage with unverified or live Windows process references.
- The background updater checks the same cross-checkout global runtime directory cap as the supervisor *before* preparing another runtime. A reached cap blocks allocating additional copies; it does not justify deleting arbitrary directories.
- Never automatically remove unrelated `phoenix-*` or `kokoro-*` project/evidence folders or persistent `.dsh` user data.

## Alternatives considered

- **Delete everything in the short-path directory** — would destroy research, projects, active worktrees and rollback evidence.
- **Remove the current staging directory on every periodic timer** — races with the background updater while it is compiling or resetting that same worktree.
- **Preserve all versions until an age threshold** — allows gigabyte-scale growth during frequent releases.
- **Remove the last-known-good copy before activation is healthy** — makes a failed release significantly harder to recover.
- **Force-delete Windows-locked registered worktrees** — risks corrupting an active checkout; wait for a safe shutdown and verify process ownership instead.

## Consequences

The normal lifecycle removes stale inactive runtime copies once the new Host is healthy; a clean shutdown or guarded offline repair can also free idle staging. Windows locks and stale markers may defer deletion rather than causing unsafe removal. Cross-checkout capacity failures are explicit and prevent additional disk use. The logical file sizes reported by the storage audit are diagnostic estimates, not exact recoverable space because of pnpm hardlinks.
