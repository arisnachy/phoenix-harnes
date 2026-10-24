# Agent Note: Sol-to-Luna handoff can strand autonomous Goal turns

Status: implemented

English | [中文](2026-10-16-sol-luna-goal-turn-resume.zh.md)

## Problem
The Lead `agent/turn-stopping` gate required an actionable *human message in the current turn*. The Goal supervisor uses `source.kind=goal` for authorized automatic continuation, so Sol strategy turns in later Goal rounds have empty `directUserTextForTurn`. The gate returned before handing Sol to Luna, leaving the mission apparently stopped. An ephemeral `lastRescueStep` check could likewise miss the genuine Sol source after process restoration, and a temporarily blank selector obscured the persisted Auto route.

## Decision
Recognize an admitted Goal continuation only while the latest durable Goal snapshot is active for the same ID. Keep explicit user cancellation, completed/cleared Goals and unrelated providers terminal. Prefer the real Sol model source as the rescue receipt, with the old no-source step marker fallback; always hand this bounded consult to Luna even if prose-continuation budget was already spent. Restore only a persisted Auto selection while the in-memory selector is empty, never overriding a live explicit provider selection. Duplicate turn-stopping callbacks remain idempotent.

## Verification
Added focused mock regressions for the Brandpoll-style seventh Goal turn (no human message; Sol announces next form action), Luna tool restoration and max reasoning route, and completed Goal non-restart. Confirm on Windows with a real interrupted session and provider quota available.

## Consequences

Human cancellation, completed Goals and explicit provider overrides retain precedence.

## Alternatives considered

Require a new human message for every already-authorized Goal continuation. Rejected because it strands persistent automatic rounds.
