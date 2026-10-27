# Agent Note: Kira zero-token mission launchpad

Status: implemented

English | [中文](2026-10-27-kira-zero-token-mission-launchpad.zh.md)

## Problem

Phoenix has a durable user-profile greeting and a verified proactivity feed, but an empty conversation gives no guided path
from a user's intent to a concrete mission. Adding autonomous provider calls at startup would consume tokens and risk acting
on incomplete context. A fixed personal identity in the public UI would also be inappropriate for other users.

## Decision

The blank conversation hero offers three universal, Spanish-language mission starters: continue, investigate and build.
Selecting a starter writes a transparent, editable draft through the existing input machine. It neither submits the
message nor calls a model or tool. The shortcuts appear only when a workspace is selected, the composer is unblocked,
no unsent draft exists and no proactive item needs attention. Proactive notices retain priority.

The implementation reuses the resident composer and profile-aware welcome; it does not add a persistent store, settings
schema, prompt injection, autonomous scheduler, permission change or dependency. The prompts request verified evidence
and never claim unverified completion.

## Alternatives considered

**Start missions automatically upon opening Phoenix.** Rejected: every startup would create provider cost and could
mutate a project without the user choosing an intent.

**Hardcode the owner's personal identity and projects.** Rejected: the UI is shared and profile data is user-owned.

**Replace the composer with a separate mission wizard.** Rejected: that duplicates input state and risks losing drafts.

## Consequences

Phoenix offers a calm, no-token on-ramp to real work. The user edits and submits a mission when ready. This feature does
not make Kira autonomous by itself and cannot verify providers, existing tasks or project access without an active run.
A focused client regression covers draft precedence, the available shortcuts and no automatic submission.
