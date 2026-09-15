# Agent Note: Pending-work privacy and transcript hygiene

Status: implemented

English | [中文](2026-09-15-pending-work-privacy-transcript-hygiene.zh.md)

## Problem

A request such as “what do I have pending?” could still feel mechanical after the human-presence work. The model might narrate that it was about to inspect tasks, overstate a partial lookup as globally complete, volunteer unrelated family/profile details as suggested topics, and end with an unnecessary menu. Separately, transient technical chrome such as the Tools disclosure and Phoenix work-status row could contaminate ordinary transcript selection/copy, producing artifacts such as `svgToolssvg` even though the SVGs were interface elements rather than assistant prose.

## Decision

The human-presence contract now treats personal profile and memory as private background context: personal or family details are mentioned only when directly relevant to the current request or explicitly requested. Simple status/lookup/review questions retrieve silently and lead with findings instead of narrating inspection steps. Pending-work reviews must consult every available authoritative source that can materially represent outstanding work in the intended scope, deduplicate findings, and avoid global “nothing else is pending” claims unless that scope was actually exhausted. Partial coverage is stated as partial coverage. Unrelated memories must not become suggested conversation topics or a menu at the end of the answer.

The consented profile block carries the same relevance boundary so profile entries are not treated as material to surface merely because the user allowed them into model context.

Transient technical chrome remains visible and interactive in Phoenix, but the Tools disclosure and running-turn status are `user-select: none`. They are interface controls/status, not conversational prose, so ordinary transcript selection/copy excludes them while tool details remain available through the dedicated UI.

## Verification

`packages/profile/user-profile/tests/user-profile.spec.ts` pins private-memory relevance, result-first status behavior, exhaustive/scoped pending-work claims, and the ban on unrelated-memory menus. `packages/client/ui-conversation/tests/technical-chrome-copy-isolation.client.spec.ts` pins copy isolation for the Tools disclosure and transient Phoenix status.

## Consequences

Phoenix can still use personal context, scheduled work, goals, missions, inbox state, and project/session state when relevant; the change affects relevance, scope claims, and presentation rather than deleting capabilities. Technical activity remains inspectable in the UI but no longer behaves like assistant prose during normal copying.
