# Agent Note: Protected PHOENIX self-evolution

Status: implemented

English | [中文](2026-08-24-phoenix-hardness-self-evolution.zh.md)

## Problem

PHOENIX can give a model filesystem, shell, terminal, and self-modification capabilities. If those capabilities write directly into the checkout that is currently executing the model, one incomplete edit to composition, package metadata, generated artifacts, or runtime code can break boot before the model can diagnose or repair its own change. The durable PHOENIX home is similarly sensitive because profile patches and runtime state survive a source reinstall.

## Decision

The Windows PHOENIX launcher marks the live checkout with `PHOENIX_RUNTIME_ROOT` and creates a detached sibling Git worktree for self-evolution, exposed as `PHOENIX_EVOLUTION_ROOT`. The shared sandbox policy treats the live runtime and PHOENIX data home as protected whenever that launcher fact is present. Model-controlled `danger-full-access` resolves to `workspace-write`; a writable session whose cwd overlaps a protected root is redirected to the evolution worktree. If the safe worktree is absent or overlaps a protected root, self-modification resolves read-only.

The model can edit, install dependencies, build, test, and iterate inside the evolution worktree. The worktree is not the running runtime and it is detached deliberately, so activation remains a separate trusted release operation. Managed installations consume only a promoted stable manifest; candidate builds and smoke tests run before live activation, and failed activation restores the previous checkout.

The protection applies at `ctx.sandboxPolicy`, the shared policy owner used by filesystem, shell, and terminal enforcement, rather than at a prompt or one tool. Trusted updater and in-process persistence services do not obtain authority through model-controlled sandbox modes and retain their owned writes.

## Alternatives considered

**Let the model edit the live checkout and rely on Git rollback.** Rejected because a broken boot can remove the very tools and services required to perform the rollback, and changes under the durable PHOENIX home may survive replacing the checkout.

**Make PHOENIX permanently read-only.** Rejected because self-evolution is an intended capability. Isolating mutation preserves that capability while separating experimentation from activation.

**Protect only individual sensitive files.** Rejected because the sensitive set is architectural and changes over time. Protecting the complete live runtime and durable PHOENIX home avoids a brittle denylist and keeps new files protected by default.

## Consequences

A model can make destructive or incomplete edits without corrupting the runtime serving its current session, and can use build or test failures from the evolution worktree as feedback for another repair attempt. A failed worktree setup reduces self-modification to read-only instead of granting access to the live checkout. Full-machine model writes are intentionally unavailable during a HARDNESS-protected PHOENIX launch; broad writes remain scoped to the resolved workspace. Promotion has an additional explicit boundary, so self-evolution requires validated activation rather than becoming live as a side effect of editing files.
