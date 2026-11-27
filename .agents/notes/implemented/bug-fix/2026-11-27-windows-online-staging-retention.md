# Agent Note: Preserve Windows staging during online cleanup

Status: implemented

## Problem

Online storage cleanup could remove the updater staging worktree between an idle check and the next build. Git worktree removal on Windows could also leave a directory after losing its Git metadata. An unverified canonical directory and an older quarantine block further staging.

## Decision

Keep the current staging worktree during automatic online cleanup. Use the existing stage protection and process checks to reclaim it during orderly shutdown or guarded offline repair. Confirm that the worktree path has disappeared before counting the removal as successful.

## Alternatives considered

A process census alone cannot reserve the worktree while Git removes it. Automatically deleting an unverified staging directory would discard data whose ownership has not been established.

## Consequences

The watcher can reuse its staging cache while the Host is online. Offline reclamation remains available for idle staging.
