# Agent Note: Phoenix Team Studio

Status: implemented

English | [中文](2026-10-06-phoenix-team-studio.zh.md)

## Problem

Phoenix already had a twenty-person KIRA portrait roster and real Team execution, but identity was effectively product-owned: Kira and the specialists kept fixed visible names, roles and portraits. A user could not create several themed teams, rename the lead, edit personalities or voices, or ask Kira to turn a natural-language concept into an applied Team design. Treating a visual rename as a runtime rename would also be unsafe because Team routing, persistence and authorization depend on stable member identities.

## Decision

Add a settings-backed Team Studio document to `@phoenix-ai/dsh-agent-team`. The document keeps one immutable lead slot plus exactly twenty immutable specialist ids while making display name, role, gender/self-reference, personality, voice description, avatar assignment, enabled state and motion level user-editable. It can retain up to twelve saved teams and selects one active team. The complete document is stored in one scalar settings field so a browser write cannot expose a half-updated generated roster.

The Settings UI contributes a new Team section. It reuses the existing reactive KIRA portrait component instead of introducing static avatar artwork or a second animation system. The user can switch teams, create, duplicate or delete one, edit Kira or any specialist, and choose subtle, normal or expressive avatar motion. Twenty design slots do not change the execution policy: the runtime continues to start only the one-to-three teammates justified by the work.

`@phoenix-ai/dsh-tool-agent-team` contributes a Lead-only `design_team` tool. The Team Studio prompt box sends the user's concept into the current Phoenix conversation and tells Kira to apply, not merely describe, the resulting design with that tool. Runtime member ids remain stable, while the active user-designed persona supplies the compact social style for the Lead or teammate. The chat author, Team messages, live dock and @mention alias resolution project the active display identities. Franchise references are treated as creative direction for an original reinterpretation rather than instructions to reproduce protected characters verbatim.

## Alternatives considered

**Rename the actual Team members.** Rejected because runtime names are durable routing and authorization addresses. Visual identity must not invalidate Session history, queued mailbox messages, task ownership, or directed replies.

**Run all twenty designed agents.** Rejected because a design roster is an identity catalog, not a reason to spend twenty model calls. Phoenix keeps the existing adaptive one-to-three worker policy.

**Create a second static avatar renderer for Settings.** Rejected because Phoenix already has lightweight state-reactive portraits with reduced-motion behavior. Team Studio previews use the same component so the editor and live work stay visually consistent.

**Persist arbitrary newly generated raster bytes directly in the settings JSON.** Rejected for this release because twenty large images would turn the settings document into an asset database. Team Studio uses the durable bundled live portrait set; Phoenix's existing image-generation capability remains available in chat until generated-avatar assets have a bounded storage and authorization contract.

## Consequences

Users can now shape Kira and a full twenty-specialist roster without destabilizing Team execution. A prompt can produce an applied team identity, manual edits remain possible afterward, multiple designs survive settings reloads, and custom names work in the visible Team conversation. Model cost stays bounded because only the active persona's social contract enters a request and only a small adaptive subset of the twenty specialists executes.
