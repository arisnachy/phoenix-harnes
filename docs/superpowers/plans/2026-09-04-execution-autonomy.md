# PHOENIX execution autonomy implementation plan

## Goal

Close the five execution gaps without duplicating PHOENIX's existing primitives: desktop/OS control, first-class permission coverage for that control, parallel Git worktree isolation, user-facing rewind/fork, and resumable E2B ownership.

## Design

### 1. Computer Use

Reuse PHOENIX's existing durable permission system instead of introducing a second desktop-specific permission state that could drift from it. Desktop authority is derived monotonically from the effective sandbox mode:

- `read-only` -> `observe`: screenshots are allowed; all desktop input is denied.
- `workspace-write` -> `interact`: desktop input is available only through the existing user-approval channel.
- `danger-full-access` -> `interact`: the user's explicit full-access choice authorizes desktop input without a second prompt.

The Windows actuator exposes only a closed model-facing action vocabulary: `screenshot`, `move`, `click`, `double_click`, `drag`, `type`, `key`, and `scroll`. Model strings are never interpolated into executable PowerShell; a fixed encoded driver receives values through environment variables and invokes Win32 input APIs. Screenshot bytes are persisted through `ctx.attachments` and injected as a durable image into the next model step.

Delegated children inherit the parent's sandbox authority through PHOENIX's existing delegation policy. A workspace-write child cannot bypass approval because delegated approval is pinned to `never`, making an attempted interactive action fail closed. A child can therefore never gain desktop authority beyond the parent.

### 2. Parallel worktrees

Add a Git-worktree helper to the shared in-process subagent driver. One-shot spawn/fork providers enable isolation by default. The helper discovers the owning Git root, creates a deterministic child branch/worktree, supplies its path as the child session cwd, and removes only clean worktrees during teardown. Dirty worktrees are preserved so uncommitted agent work cannot be destroyed. Outside a Git workspace the behavior remains the historical shared cwd.

### 3. Rewind/fork UX

Extend the mounted session checkpoint policy with `/fork` and `/rewind` commands. Both are non-destructive: they use the append-only session store's existing `sessions.fork()` primitive. `/rewind N` selects a completed `turn/end` boundary before the requested recent turns, because `SessionStore.fork()` correctly rejects boundaries inside an open turn. The command returns the new session id and boundary so UIs and the user can switch to it. This is conversation-state rewind; filesystem rewind is intentionally not fabricated outside a managed Git worktree.

### 4. E2B durability

Extend `E2BRuntime` with `sandboxId`, `retention`, and `autoPause` configuration. A configured sandbox id reconnects through `Sandbox.connect()`, which also resumes paused sandboxes. New sandboxes expose their id through runtime state. Disposal can `kill`, `pause`, or `retain` rather than always deleting the sandbox. Setup remains idempotent on reconnect and a failed adoption never destroys a sandbox supplied by id.

## TDD / verification

1. Add failing contract tests for each new behavior and observe CI fail for missing exports/behavior.
2. Implement the production code and focused regression coverage.
3. Run repository PR CI, including native Windows gates; inspect every failed job and fix regressions until green.
4. Merge verified changes to `main`, replay/adapt the same change onto `stable`, and verify both branch heads.

## Safety invariants

- Desktop input is impossible under `read-only` and when no effective sandbox authority exists.
- Screenshot is impossible when Computer Use is effectively off.
- `workspace-write` input requires the existing approval channel; delegated children cannot bypass it.
- Model-provided desktop text/key data never becomes executable shell source.
- Rewind never truncates or rewrites an existing session log.
- Worktree teardown never destroys a dirty workspace.
- E2B retention is explicit; the default remains `kill` for backward compatibility.
