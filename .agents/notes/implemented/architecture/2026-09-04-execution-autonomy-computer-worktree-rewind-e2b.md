# Execution autonomy: Computer Use, worktrees, rewind, and E2B lifecycle

Date: 2026-09-04
Status: implemented

## Scope

PHOENIX closes four execution-lifecycle gaps without replacing the existing permission, session, subagent, or remote-runtime seams: Windows Computer Use, Git worktree isolation for one-shot in-process subagents, non-destructive session fork/rewind commands, and reconnectable E2B ownership.

Search anchors: `computer use`, `worktree`, `rewind`, `E2B`.

## Computer Use

`@phoenix-ai/dsh-tool-pwsh` registers a Windows-only `computer` tool with the closed action vocabulary `screenshot`, `move`, `click`, `double_click`, `drag`, `type`, `key`, and `scroll`. Model-provided values travel only through environment variables into one fixed PowerShell/C# driver; they are never interpolated into executable source.

Desktop authority derives from the session's existing sandbox policy instead of introducing another durable permission knob. `read-only` maps to observe-only, while `workspace-write` and `danger-full-access` map to interact. Interactive actions under `workspace-write` use the existing approval service; `danger-full-access` is the explicit no-prompt authority. Missing sandbox/approval facts fail closed. Screenshot output is stored through the optional attachment capability and injected into the session as a model-visible image so the next step can ground coordinates.

The Windows implementation uses user32 input primitives and a virtual-screen PNG capture. The plugin is not registered on non-Windows hosts.

## Git worktree isolation

`@phoenix-ai/dsh-subagent-in-process-driver` can create a deterministic branch and linked worktree for a one-shot child. The shipped spawn and fork providers enable this by default. Non-Git workspaces remain unchanged; once a Git repository is detected, creation failure is fatal rather than silently falling back to shared writes.

Teardown removes only clean worktrees. Dirty worktrees are preserved. The child branch is retained even after a clean worktree is removed so committed work is not destroyed by lifecycle cleanup.

Continuable fork sessions are unchanged because they are owned by the continuation manager rather than the one-shot driver.

## Session rewind and fork

`@phoenix-ai/dsh-session-checkpoint-policy` contributes `/fork [event-seq]` and `/rewind [completed-turns]` when the commands capability is present. Both operations call the existing append-only `sessions.fork()` primitive; neither truncates or rewrites the source session.

A rewind boundary is the preceding completed `turn/end` event, because `SessionStore.fork()` takes an inclusive event sequence and rejects a boundary ending inside an open turn. Filesystem rollback is intentionally not implied by conversation rewind; Git worktrees provide filesystem isolation for parallel agent work.

## E2B lifecycle

`@phoenix-ai/dsh-e2b` accepts an existing `sandboxId`, reconnects with the SDK, reapplies the configured timeout, and exposes the live sandbox id for persistence. Disposal has explicit `kill`, `pause`, and `retain` policies. `kill` remains the default for backward compatibility. Newly created sandboxes still roll back on setup failure, while a user-supplied reconnected sandbox is never destroyed merely because PHOENIX failed to adopt it.

## Safety invariants

- Desktop input is impossible under observe-only authority.
- Desktop actions are a closed, validated vocabulary; model strings never become PowerShell source.
- Worktree teardown never deletes dirty child work.
- Rewind preserves the original session and future.
- E2B retention is explicit and defaults to historical kill-on-dispose behavior.
