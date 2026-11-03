# User-governed deletion and bulk conversation cleanup

An ordinary active Web conversation is no longer rejected merely because
the Agent is loaded. The Host retains the AgentHandle for each Host-owned
created/resumed session, fences concurrent creation/resume while a delete
is in flight, disposes the owner (cancels and drains its work), waits for
the persistence retirement barrier, then physically removes the session
log and unregisters its workspace membership.

The permanent-deletion gateway still refuses agents owned by different
lifecycles, including active subagents, until that distinct owner can
authorize disposal. This prevents a late writer from recreating a deleted
session. The UI has a bulk cleanup panel with exact ids, a last-activity
date cutoff, an inclusive range, or all; the all mode requires a typed
confirmation. Each selected session uses the ordinary authenticated
single-session delete RPC. Completion and failures are counted separately.

The scope is conversation persistence and per-session log directories,
not shared project files or globally referenced attachment blobs. Never
claim space recovered without filesystem measurement. A future storage
inspector/garbage collector may show measured bytes by category and
safely clean only zero-reference blobs.

## Acceptance checks added

Unit coverage for deletion admission and retained Host ownership on
cold resume, and for all/date/selection preview semantics with invalid
date fail-closed. Both were enrolled in the main Windows gate.
A live filesystem smoke on Windows and shared-attachment reference-count
inspection remain outstanding.
