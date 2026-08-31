# Agent Note: resilient goal judging and active team roster

Status: implemented

English | [中文](2026-08-31-goal-judge-provider-and-active-team-roster.zh.md)

## Problem

Goal completion selected the configured `spawn` alias directly. A missing alias, a provider-only deployment, or a provider registry transition therefore returned a blocked judge result or a `GOAL_JUDGE_UNAVAILABLE` tool error even when another structured review provider was available. The KIRA teams dock also retained settled children and showed a terminal `done` state, causing the visible roster to grow without limit.

## Decision

The subagent seam now resolves independent structured reviewers by capability: it prefers the configured provider when it supports structured output and tool filtering, then searches registered providers in stable order, preferring providers that do not inherit parent conversation. Goal, Organization Forge, specialist, and HARDNESS reviews use that resolver. A missing service or temporarily unavailable provider produces a neutral pending-verification result and leaves the goal active, without weakening the passing criteria or exposing provider internals in model-facing text. The teams dock filters its lineage to running children and renders the active model persona beside each task label.

## Alternatives considered

**Remove the judge gate when the configured provider is absent.** Rejected because an unavailable judge must never certify an unverified deliverable.

**Always use the first registered provider.** Rejected because deployment configuration should win when its provider is usable, and inherited-context providers are a weaker independent-review choice.

**Keep every child visible and mark settled rows as done.** Rejected because the requested team surface is an active roster, not an archive; historical sessions remain available through conversation and session search.

## Consequences

Temporary provider alias changes no longer stop a persistent mission or require a user-facing technical recovery step. A mission still cannot enter DONE without a structured passing judge and its existing evidence and quality gates. The teams dock becomes compact and live: a finished child disappears, while an active child shows its task label, agent persona, and running state.

## Testing

Focused goal-judge tests cover fallback selection and the no-service pending result. Goal-tool tests cover keeping the goal active without throwing a provider error. The KIRA teams tests cover removal of settled children and the visible Luna persona. HARDNESS uses the same resolver and retains its existing fail-closed structured-decision tests.
