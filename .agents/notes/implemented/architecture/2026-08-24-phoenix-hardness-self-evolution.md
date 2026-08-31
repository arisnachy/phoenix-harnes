# Agent Note: Protected PHOENIX self-evolution

Status: implemented

English | [中文](2026-08-24-phoenix-hardness-self-evolution.zh.md)

## Problem

PHOENIX can give a model filesystem, shell, terminal, and self-modification capabilities. If those capabilities write directly into the checkout that is currently executing the model, one incomplete edit to composition, package metadata, generated artifacts, or runtime code can break boot before the model can diagnose or repair its own change. The durable PHOENIX home is similarly sensitive because profile patches and runtime state survive a source reinstall.

## Decision

The Windows PHOENIX launcher marks the live checkout with `PHOENIX_RUNTIME_ROOT` and creates a detached sibling Git worktree for self-evolution, exposed as `PHOENIX_EVOLUTION_ROOT`. The shared sandbox policy treats the live runtime and PHOENIX data home as protected whenever that launcher fact is present. Model-controlled `danger-full-access` resolves to `workspace-write`; a writable session whose cwd overlaps a protected root is redirected to the evolution worktree. If the safe worktree is absent or overlaps a protected root, self-modification resolves read-only.

The model can edit, install dependencies, build, test, and iterate inside the evolution worktree. The worktree is not the running runtime and it is detached deliberately, so activation remains a separate trusted release operation. Managed installations consume only a promoted stable manifest.

The stable watcher also separates preparation from activation. While the current PHOENIX Host stays available, a nominated stable commit is fetched into a detached staging worktree, locked dependencies are installed, the candidate is built, and its launcher is smoke-tested. The watcher publishes its phase to repository-owned Git state and marks the target `ready` only after that preflight succeeds. The Web sidebar reads a sanitized projection of this state and renders a phase-based progress card above Settings without changing the live checkout. Temporary channel or Host-read failures remain `checking/retry` and are retried; only a candidate preparation, activation, or rollback failure becomes an update error.

The Host bridge also normalizes the legacy managed-install completion label `realigned-stable` to the current `updated` state. This prevents a successful stable realignment from appearing as an update failure after a restart, while new managed updates emit the shared state vocabulary directly.

A `ready` release may be activated by closing PHOENIX normally or by the explicit **Restart to complete update** action. The browser cannot nominate a commit: the Host accepts a restart request only for the exact target already recorded as `ready`, persists that request, returns the receipt, and only then schedules its own exit. The detached watcher observes the exit, activates the same target, rebuilds and smoke-tests the live checkout, restores the previous recovery ref on failure, and relaunches PHOENIX automatically after an explicit restart request.

The protection applies at `ctx.sandboxPolicy`, the shared policy owner used by filesystem, shell, and terminal enforcement, rather than at a prompt or one tool. Trusted updater and in-process persistence services do not obtain authority through model-controlled sandbox modes and retain their owned writes.

The attachment seam now extends the same durable lifecycle to arbitrary files. The host admits canonical base64 files only after count, per-file, aggregate, MIME, and byte checks; the local provider stores content-addressed bytes with path-free names and verifies the reference on read. Session logs retain only the opaque `FileAttachmentRef`, exports include referenced file objects, and the DeepSeek adapter reads them through the attachment service before projecting bounded UTF-8 text to a model request. Binary files remain durable and are described without inlining their bytes.

The universal HARDNESS artifact surface now has two execution providers: the existing TypeScript worker and a fresh-process `PythonCodeRuntime`. The RPC selects the provider from the artifact language, so Python execution does not replace TypeScript execution. HTML and mini-app previews report their measured document height through a postMessage from the isolated iframe; the parent accepts messages only from that frame and clamps the result to the responsive surface limits.

## Alternatives considered

**Let the model edit the live checkout and rely on Git rollback.** Rejected because a broken boot can remove the very tools and services required to perform the rollback, and changes under the durable PHOENIX home may survive replacing the checkout.

**Make PHOENIX permanently read-only.** Rejected because self-evolution is an intended capability. Isolating mutation preserves that capability while separating experimentation from activation.

**Protect only individual sensitive files.** Rejected because the sensitive set is architectural and changes over time. Protecting the complete live runtime and durable PHOENIX home avoids a brittle denylist and keeps new files protected by default.

**Apply an update as soon as it is detected.** Rejected because detection must not mutate the runtime serving the current session. Background preparation provides early failure evidence while the current version remains available, and restart remains the explicit activation boundary.

## Consequences

A model can make destructive or incomplete edits without corrupting the runtime serving its current session, and can use build or test failures from the evolution worktree as feedback for another repair attempt. A failed worktree setup reduces self-modification to read-only instead of granting access to the live checkout. Full-machine model writes are intentionally unavailable during a HARDNESS-protected PHOENIX launch; broad writes remain scoped to the resolved workspace.

Stable updates can perform expensive fetch, dependency, build, and smoke work while the current Host remains usable. The sidebar reports those real phases in a compact card and exposes Restart only after successful preparation. Activation still rebuilds and verifies the live checkout, so `ready` means the candidate passed isolated preflight rather than promising activation cannot fail; any activation failure is handled by recovery to the previous checkout. Promotion and restart remain explicit boundaries, so neither model edits nor newly detected `main` commits become live merely because they exist. A stale staging `index.lock` left by an interrupted Windows preparation is recovered before the next staging attempt.

The Python provider requires an installed CPython executable and remains containment rather than a security boundary. Its process-level budgets and empty environment reduce accidental interference, while the shared sandbox and approval services remain the authority for execution risk.

## Changed-path coverage

The update-status composition and its visible styling are implemented together in `packages/client/ui-settings-plugin-inventory/src/client/UpdateFooterAction.tsx`, `packages/client/ui-settings-plugin-inventory/src/client/UpdateFooterAction.module.css`, and `packages/client/ui-settings-plugin-inventory/src/client/index.ts`. The detached watcher and Windows launch handoff are implemented in `scripts/phoenix-auto-update.mjs` and `phoenix-windows.cmd`. These paths are part of this architectural decision and must evolve together with the protected stable-update flow.
