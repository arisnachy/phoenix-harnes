# Agent Note: Explicit goal judge routing and KIRA preferences

Status: implemented

English | [中文](2026-09-01-goal-judge-kira-provider-order.zh.md)

## Problem

The completion judge inherited the worker's route without an explicit model selection, so a Codex-backed mission did not reliably use the requested Luna xhigh reviewer. The goal driver also paused an active goal after a cancelled attempt, and the model selector had no persistent user-controlled provider order or assistant identity settings.

## Decision

`judgeGoalCompletion` now resolves explicit child options before starting the read-only judge. An `openai-codex` parent routes the judge to `gpt-5.6-luna` with `xhigh`; other parents retain their exact selected provider, model, and reasoning effort, discovering the highest advertised effort only when no effort was selected. The goal prompt identifies `update_goal(action=complete)` as the judge activation point, and a cancelled attempt remains an active recovery event.

The local user-profile namespace now owns the default KIRA name, masculine/feminine/neutral presentation, and an optional provider order. The identity is a separate prompt context that requests natural conversation without misrepresenting the assistant as human. Models Settings persists adjacent provider moves, and the Host applies the same order to advisory model groups without hiding routes.

## Alternatives considered

**Inheriting the parent route:** rejected because the judge must be independent from the worker's selected model and the requested Codex-to-Luna review would not occur.

**Using provider order as a routing whitelist:** rejected because a presentation preference must never make an otherwise registered provider unavailable.

**Pausing after a cancelled attempt:** rejected because cancellation of an attempt is not evidence that the durable mission is complete or blocked.

## Consequences

Judge availability and route capability failures remain structured `blocked` results, so the mission stays active and the next recovery round can continue. Provider-order writes require the normal writable settings service and are visible after the Host mirror refresh. Existing profile values receive schema defaults for the new identity fields; clearing identity restores KIRA and neutral presentation.

## Testing

Focused tests cover Codex/Luna routing, non-Codex route preservation, provider-order sorting and persistence, profile defaults and validation, and the Host ordering utility. Affected package typechecks cover goal, profile, client settings, and the API gateway.
