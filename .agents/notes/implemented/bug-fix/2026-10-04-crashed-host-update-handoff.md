# Agent Note: Stable update handoff while the Host is crashed

Status: implemented

## Problem

The Windows supervisor started the stable updater as a child associated with each Host lifetime. When the Host crashed during startup, the supervisor immediately stopped that updater and relaunched the same broken Host one second later. If a newer stable version was available, the updater could reset the persistent staging worktree and print "preparing stable", but it was killed before dependency refresh/build/smoke could finish. Because the Host never reached the point where its restart bridge could request activation, the supervisor repeated the same prepare/crash/kill cycle forever.

This made a repository fix impossible to receive automatically from exactly the broken state it was intended to repair.

## Decision

When an unexpected Host exit happens while updater state is `preparing`, the supervisor keeps that already-running updater alive instead of stopping it immediately. It waits for the verified prepared marker for up to five minutes by default (configurable with `PHOENIX_CRASH_UPDATE_RECOVERY_WAIT_MS`). If preparation succeeds, the supervisor stops the watcher, activates the prepared target into the verified isolated runtime, performs the existing build/smoke/boot-preflight path, re-heals the profile fallback through that runtime, and relaunches Phoenix without waiting for a Host-side restart bridge.

If the updater reports error/paused/off or the wait expires, ordinary crash recovery resumes. A failed isolated activation clears only disposable update-control markers and records a recovery report; user state remains untouched.

## Alternatives considered

**Keep restarting the Host and rely on its bridge.** The bridge cannot run when plugin loading fails before Host startup completes, so this is the deadlock.

**Make the updater process permanently global to the supervisor.** That is a broader lifecycle refactor. The targeted wait preserves current ownership semantics while keeping the one updater instance alive only when it is already preparing a repair.

**Copy missing packages into `.dsh`.** The profile fallback is intentionally a lightweight junction farm. Copying package trees back into user storage would reintroduce stale code and the previous multi-gigabyte `.dsh` growth problem.

## Consequences

A broken Host can now receive the stable version that fixes it. The console stays on the failed Host instead of relaunching it every second while a stable candidate is actively building, then switches to the verified isolated runtime as soon as preparation completes. Normal crashes with no update preparation still use the existing one-second relaunch behavior.
