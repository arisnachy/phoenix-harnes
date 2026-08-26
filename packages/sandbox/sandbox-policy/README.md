# dsh-sandbox-policy — the sandbox policy home (`ctx.sandboxPolicy`)

English | [中文](README.zh.md)

The single owner of sandbox-policy resolution: the deployment's default [`SandboxMode`](../sandbox/README.md) and fallback root, plus each session's durable mode override and immutable workspace root. Every enforcing capability receives one resolved mode-and-root policy per call; before each request, the model receives the current policy without a separate capability inventory.

## Why a shared home

Filesystem tools, one-shot bash commands, and terminal sessions may enforce the same mode vocabulary in different combinations. If each resolved its own `mode` + `workspaceRoot`, they could drift into a split world, exactly what [the sandbox Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md) warns against. Each enforcing backend consumes the complete owner-resolved policy, while the current context describes only what that policy means for any available operation the PHOENIX file sandbox enforces. The [cross-family fs sandbox Agent Note](../../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md) records the shared-policy decision.

## Config

- `mode` — the deployment default `SandboxMode` (`read-only` / `workspace-write` / `danger-full-access`), validated at load. Default `read-only` (fail-safe).
- `workspaceRoot` — the fallback directory `workspace-write` may write under for agentless calls or sessions without a cwd. Default `process.cwd()`, resolved to its absolute filesystem identity either way. A normal agent call uses its session header's immutable `cwd` instead.

## PHOENIX HARDNESS self-protection

When the PHOENIX launcher sets `PHOENIX_RUNTIME_ROOT`, this policy treats the running PHOENIX checkout and its durable data home as protected from model-controlled filesystem and shell writes. A requested `danger-full-access` is reduced to `workspace-write`; a writable session rooted at either protected location is redirected to the launcher-created `PHOENIX_EVOLUTION_ROOT` worktree. If no safe evolution worktree exists, that session resolves `read-only` instead of falling back to the live runtime. Trusted updater and in-process persistence services remain outside this model-controlled sandbox path.

## API

- `ctx.sandboxPolicy.resolve({ session?, mode? })` — resolves one complete per-call policy. An explicit approved mode outranks the session's last `sandbox/mode` event, which outranks `defaultMode`; the session's immutable `cwd` is canonicalized with filesystem semantics before becoming `workspaceRoot`, otherwise the configured fallback applies. When launcher HARDNESS protection is active, the resulting model-controlled policy is then clamped away from protected runtime/data roots and from unconfined full-machine writes. Canonicalization precedes lexical normalization so `symlink/..` agrees with process working-directory resolution.
- `ctx.sandboxPolicy.defaultMode` / `ctx.sandboxPolicy.workspaceRoot` — the deployment default and fallback root used by `resolve()`.
- `sandbox:policy` — a request-time cache-safe context contribution derived directly from `resolve({ session })`. It states the mode's capability-neutral file-effect contract and the canonical session workspace under `workspace-write`; tool owners retain operation-specific denial and escalation guidance. Under launcher HARDNESS protection it also names the isolated evolution worktree or reports that self-modification remains read-only.
- `effectiveSandboxMode(events)` — the pure fold of a session's `sandbox/mode` events (the last switch wins, or `undefined`), used inside `resolve()`.
- `setSandboxMode(session, mode)` — THE write path for a per-session override: appends exactly one `sandbox/mode` event. The switch IS its event; nothing mutates the mode out of band.
- `SANDBOX_MODES` — every mode, for option advertisement and runtime validation.

The optional `./invariant` companion rejects a forged durable `sandbox/mode` event whose value falls outside that closed vocabulary; Session and its companion own the surrounding storage and core execution-enclosure rules. The agent loop logs the assembled full runtime-context snapshot as a sourced `user/message`, so exact policy input remains reconstructable without an in-memory “last told” mirror.

## The per-session store

A runtime switch is one log-only `sandbox/mode` event on the session it applies to. `effective = explicit grant ?? fold(events) ?? deployment default`, so an override survives restart by replay and two sessions never see each other's state. Workspace identity does not need another event: the immutable `SessionHeader.cwd` recorded at creation is the root for every call in that session unless launcher HARDNESS protection redirects a protected self-edit to the isolated evolution worktree. The event stays log-only; before the next request, the owner contributes the current fact to the full runtime-context snapshot.

## Model Experience

### Current file sandbox policy

One `sandbox:policy` contribution in the current runtime-context snapshot for every agent session. It does not enumerate mounted capabilities. Tool plugins retain operation and escalation guidance, approval policy contributes separately to the same snapshot, and plan guidance remains `dsh-plan-mode`'s system section. With launcher HARDNESS protection active, the same contribution states that the live PHOENIX runtime and data home are protected and directs self-modification to the isolated evolution worktree.

#### What the model sees

##### Read-only

```markdown
Current PHOENIX file policy: read-only. Any available operation enforced by the PHOENIX file sandbox cannot modify files in the standing mode. Do not refuse a required modification from this policy alone: try an available tool normally and follow any denial and escalation guidance it returns.
```

##### Workspace-write

```markdown
Current PHOENIX file policy: workspace-write. Any available operation enforced by the PHOENIX file sandbox may modify files under the session workspace: "<workspace root>". Some platform temporary areas may also be writable.
```

##### Danger-full-access

```markdown
Current PHOENIX file policy: danger-full-access. The PHOENIX file sandbox does not restrict file modifications by available operations.
```

#### Token effect

One concise durable context message on the first request and each effective policy change; unchanged requests add nothing. `workspace-write` carries only the canonical session workspace path; platform-specific temporary paths are summarized without adding host-dependent bytes. HARDNESS-protected self-edit sessions additionally carry the isolated evolution root in the same context contribution.

#### KV Cache effect

The stable system prompt remains byte-identical across mode changes. A changed full context snapshot is appended after retained history, preserving the prior cached prefix; subsequent unchanged requests reuse that retained snapshot.

## Known Limitations and Deferred Work

- **One primary workspace root per session** — policy resolves `SessionHeader.cwd`; extra writable roots are not part of `SandboxExecutionPolicy`. HARDNESS redirection replaces that root for protected self-edit sessions rather than adding a second writable root.
- **File-effect modes only** — `SandboxMode` governs file effects; network and process policy are outside its vocabulary, so no knob here restricts them.
- **Temporary areas are deliberately summarized** — enforcing backends grant different platform temporary areas, which are selected after policy resolution and therefore cannot be enumerated truthfully in the current context.
