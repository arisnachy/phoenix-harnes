# Agent Note: Codex and OpenClaw staged upstream intake

Status: implemented

English | [中文](2026-08-31-codex-openclaw-upstream-intake.zh.md)

## Problem

The Codex and OpenClaw bridges synchronized directly into `$DSH_HOME`, so an upstream change or a partial bridge failure could replace working skills and leave PHOENIX without a usable integration.

## Decision

PHOENIX has a separate upstream intake worker at `scripts/phoenix-upstream-update.mjs` and the launcher command `dsh upstream-update`.

The worker compares initialized bridge states with the official `main` heads for `openai/plugins` and `openclaw/openclaw`, stages changed bridges in a private same-volume staging home, runs each native `sync` and `verify`, and activates only verified candidates.

Activation moves bridge roots and provider-namespaced managed skills through a journaled filesystem transaction; user-owned skills remain outside the transaction. Live verification failure reverses the transaction from its per-run backup, and an interrupted transaction is recovered before the next check.

The watcher is independent of PHOENIX profile boot. `auto` applies verified candidates, `notify` records availability, and `off` disables intake. Unconfigured bridges remain idle. Update state stores commits, statuses, errors, and transaction identifiers but never credential values.

Codex exposes a structural `verify` command that checks source identity, unique plugins and skills, managed paths, enabled MCP references, and generated patch safety. The intake rejects legacy `@deepseek-ai/` references and literal credential-like values in generated state and patches.

## Alternatives considered

**Synchronizing directly into the active bridge:** rejected because fetch, parsing, or verification failures could damage the working installation.

**Replacing the whole DSH home:** rejected because it would risk user skills, sessions, memories, credentials, and unrelated provider data.

**Automatically initializing missing bridges:** rejected because a watcher must not silently install a catalog the user has not enabled.

**Using PHOENIX source `main` or `stable` as the upstream source:** rejected because external bridge updates require a separate trust and rollback boundary from PHOENIX source releases.

## Consequences

Initialized Codex and OpenClaw bridges can receive future upstream revisions without making the active harness depend on network availability or an unverified candidate. Failed candidates remain available for diagnosis and the last verified bridge remains active. The bridge update transaction retains backups under `$DSH_HOME/.phoenix-upstream-updates`, which requires bounded operational cleanup in a later maintenance feature.

## Testing

The intake tests cover mode validation, official commit parsing, update classification, credential and namespace rejection, and an activation plan that excludes user-owned skills. Source launcher coverage exercises `dsh upstream-update --help`; the installed Codex bridge passes structural verification and the live intake check reads both official upstream heads without activating them.
