# Agent Note: Execution autonomy for Computer Use, worktrees, rewind, and E2B

Status: implemented

English | [中文](2026-09-04-execution-autonomy-computer-worktree-rewind-e2b.zh.md)

## Problem

PHOENIX had strong permission, session, subagent, and remote-runtime primitives but lacked a coherent product path for Windows desktop control, isolated parallel filesystem work, user-facing rewind, and resumable E2B ownership. Adding those capabilities independently risked duplicating authority knobs, destroying child work during teardown, mutating session history, or accidentally deleting a user-owned remote sandbox.

Search anchors: `computer use`, `worktree`, `rewind`, `E2B`.

## Decision

`@phoenix-ai/dsh-tool-pwsh` registers a Windows-only `computer` tool with the closed action vocabulary `screenshot`, `move`, `click`, `double_click`, `drag`, `type`, `key`, and `scroll`. Model-provided values travel only through environment variables into one fixed PowerShell/C# driver and are never interpolated into executable source. Desktop authority derives from the existing sandbox policy instead of adding another durable permission knob: `read-only` is observe-only, while `workspace-write` and `danger-full-access` permit interaction. Interactive actions under `workspace-write` use the existing approval service; `danger-full-access` is the explicit no-prompt authority. Missing authority fails closed. Screenshots are stored through the optional attachment capability and deferred into model context as image content.

`@phoenix-ai/dsh-subagent-in-process-driver` creates a deterministic branch and linked Git worktree for one-shot children when isolation is enabled. The shipped spawn and fork providers enable it by default. Non-Git workspaces remain unchanged; once Git is detected, worktree creation failure is fatal rather than silently degrading to shared writes. Teardown removes only clean worktrees, preserves dirty worktrees, and retains the branch so committed child work is never destroyed by lifecycle cleanup. Continuable fork sessions remain shared-workspace because that path is owned by the continuation manager rather than the one-shot driver.

`@phoenix-ai/dsh-session-checkpoint-policy` contributes `/fork [event-seq]` and `/rewind [completed-turns]` when the commands capability is present. Both call the existing append-only `sessions.fork()` primitive, so the source session and its future remain intact. A rewind boundary is the preceding completed `turn/end` event because `SessionStore.fork()` takes an inclusive event sequence and rejects boundaries that end inside an open turn. Conversation rewind deliberately does not pretend to roll back arbitrary filesystem state; Git worktrees provide filesystem isolation for parallel child work.

`@phoenix-ai/dsh-e2b` accepts an existing `sandboxId`, reconnects through the SDK, reapplies the configured timeout, and exposes the live sandbox id for persistence. Disposal supports explicit `kill`, `pause`, and `retain` policies, with `kill` remaining the backward-compatible default. Newly created sandboxes still roll back on setup failure, while a reconnected user-supplied sandbox is never destroyed merely because PHOENIX failed to adopt it.

## Alternatives considered

**A separate durable `computer/mode` permission knob** — rejected because it could drift from the already persisted sandbox and approval policy. Reusing those facts makes desktop authority inherit naturally through the existing session and subagent permission model.

**Shared working directories for parallel one-shot subagents** — rejected as the default because concurrent writes can collide and make ownership ambiguous. Git worktrees provide repository-native isolation without copying the repository manually.

**Destructive rewind by truncating the session log or resetting files** — rejected because PHOENIX sessions are append-only and arbitrary filesystem rollback cannot be inferred safely. Rewind therefore forks history non-destructively.

**Always killing E2B sandboxes on disposal** — retained as the default but no longer the only policy; long-horizon workflows need explicit pause or retain semantics and safe reconnect.

## Consequences

- Desktop input is impossible under observe-only authority, and the model receives only a closed validated action surface rather than arbitrary host commands.
- One-shot Git subagents receive isolated checkouts by default, while dirty or committed work survives cleanup.
- `/fork` and `/rewind` preserve the original conversation and future instead of rewriting history.
- E2B sessions can survive a PHOENIX process lifecycle when the caller explicitly chooses `pause` or `retain`, while historical `kill` behavior remains the default.
- Windows Computer Use is the first built-in desktop actuator; non-Windows hosts do not register it.
