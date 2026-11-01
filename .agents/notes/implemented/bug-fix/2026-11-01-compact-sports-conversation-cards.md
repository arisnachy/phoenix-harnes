# Agent Note: Compact sports cards within the conversation

Status: implemented

English | [中文](2026-11-01-compact-sports-conversation-cards.zh.md)

## Problem

Sports event cards, schedules, and data-driven intelligence views used different visual scales. A single result occupied more space than several fixtures and repeated large team logos, provider names, source footers, and supporting details in a chat conversation. Dense multi-sport schedules became harder to browse, especially on narrow screens.

## Decision

The shared sports renderer presents individual games and intelligence panels in a 420-pixel responsive card, with team logos around 23–25 pixels, a compact score hierarchy, and expanded detail only on request. A schedule stays a small responsive fixture grid rather than introducing navigation or a separate page. Additional venue information, player data, research, play-by-play, and article links remain accessible through native disclosure elements.

Provider identities continue to exist in validated response data, network endpoints, and internal actions, but the conversational presentation uses neutral sports labels, time stamps, and status messages. This does not change a provider's data accuracy, licensing requirements, or provenance recorded in the data payload.

The odds and ticket cards use tighter spacing without removing the warnings that distinguish research from an accepted wager. The sports news view uses the same white theme surface, two-column image-first article tiles, a readable local timestamp, and provider-neutral link labels. English source headlines and summaries are translated to Spanish only through a browser's already-installed on-device translation model. If this model is unavailable, the original verified text remains visible and the user may explicitly ask Kira to translate it; the client does not make undocumented remote translation requests.

## Alternatives considered

- **A dedicated full-screen match center.** It adds navigation and increases the distance between the user's question and the answer.
- **Hiding entire sections without disclosure.** It shortens cards but removes important context needed for research and analysis.
- **Per-sport handcrafted layouts.** They drift in spacing and accessibility when more leagues are added, unlike the shared renderer.

## Consequences

The initial viewport now prioritizes opponents, scores, status, and match time; a secondary action exposes detailed information without discarding it. The card can grow when the user opens the detail disclosure. The provider-neutral visual language does not alter event IDs, live polling, odds verification, or historical results.

## Testing

The sports-rich UI tests check the preview, native disclosure, and provider-neutral display. Existing game center and live adapter tests continue to validate event polling, cancellation, and missing-data behavior. Full CI is required before promotion to main and stable.
