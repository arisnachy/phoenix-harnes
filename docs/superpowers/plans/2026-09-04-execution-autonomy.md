# PHOENIX execution autonomy implementation plan

## Goal

Close the five execution gaps without duplicating PHOENIX's existing primitives: desktop/OS control, first-class permission coverage for that control, parallel Git worktree isolation, user-facing rewind/fork, and resumable E2B ownership.

## Design

### 1. Computer Use

Extend `@phoenix-ai/dsh-permission-presets` with a third durable permission knob, `computer/mode`, whose vocabulary is `off | observe | interact`. The same package will expose model-facing computer tools backed by a host-only desktop actuator. Screenshot output is persisted through `ctx.attachments`; input actions are fail-closed and use the existing approval policy. Windows is the first built-in actuator, implemented through a PowerShell/Win32 boundary without third-party native dependencies.

Preset mapping in the shipped base profile:

- `read-only`: `computer: observe`
- `workspace-write`: `computer: interact`, with the existing `approval: ask`
- `danger-full-access`: `computer: interact`, with the existing `approval: never`; because the user selected this preset explicitly, input actions do not issue a second approval request.

Delegated children receive a captured `computer/mode` event. A child never gains a wider computer mode than its parent.

### 2. Parallel worktrees

Add a Git-worktree helper to the shared in-process subagent driver. One-shot providers can opt into isolation. The helper discovers the owning Git root, creates a deterministic child branch/worktree, supplies its path as the child session cwd, and removes only clean worktrees during teardown. Dirty worktrees are preserved so uncommitted agent work cannot be destroyed. The feature remains opt-in at the provider seam to avoid silently changing existing shared-workspace semantics.

### 3. Rewind/fork UX

Extend the mounted session checkpoint policy with `/fork` and `/rewind` commands. Both are non-destructive: they use the append-only session store's existing `sessions.fork()` primitive. `/rewind N` forks at the start boundary of the Nth most recent completed turn and preserves the original future. The command returns the new session id and boundary so UIs and the user can switch to it. This is conversation-state rewind; filesystem rewind is intentionally not fabricated outside a managed Git worktree.

### 4. E2B durability

Extend `E2BRuntime` with `sandboxId`, `retention`, and `autoPause` configuration. A configured sandbox id reconnects through `Sandbox.connect()`, which also resumes paused sandboxes. New sandboxes expose their id through runtime state. Disposal can `kill`, `pause`, or `retain` rather than always deleting the sandbox. Setup remains idempotent on reconnect.

## TDD / verification

1. Add failing contract tests for each new behavior and observe CI fail for missing exports/behavior.
2. Implement the minimum production code to make the focused tests pass.
3. Add real Git worktree integration coverage in a temporary repository and a real-composition permission/session command test.
4. Run the repository PR CI gates, inspect every failed job, fix regressions, and rerun until green.
5. Merge verified changes to `main`, replay/adapt the same tree on `stable`, and verify branch heads contain the feature commits.

## Safety invariants

- Computer input is impossible when mode is `off` or `observe`.
- Screenshot is impossible when mode is `off`.
- Delegation cannot widen computer authority.
- Rewind never truncates or rewrites an existing session log.
- Worktree teardown never destroys a dirty workspace.
- E2B retention is explicit; the default remains `kill` for backward compatibility.
