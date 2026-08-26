# Agent Note: Resilient web search fallback
Status: implemented

English | [中文](2026-08-26-web-search-free-fallback.zh.md)

## Problem
A paid web-search provider can fail on quota, credits, rate limits, authentication, timeouts, or temporary outages. Repeated model retries can consume the whole turn and leave the agent stopped at `maxStepsPerTurn`.

## Decision
The web seam keeps the configured provider as primary and tries an ordered keyless Bing/DuckDuckGo provider after recoverable failures. The agent loop may open up to three bounded continuation turns when queued work reaches `maxStepsPerTurn`, instead of requiring a new human prompt. Cancellation and invalid configuration remain hard failures.

## Alternatives considered
- Raising `maxStepsPerTurn` alone: rejected because it only delays runaway loops.
- Silently retrying every provider error: rejected because cancellation and configuration errors must remain visible.
- Requiring a paid search key: rejected because the fallback must work without additional credits.

## Consequences
The model can continue a legitimate tool chain after a boundary, while pathological loops still stop after a bounded number of automatic continuations. Free HTML search may vary by region or anti-bot policy and must be treated as corroboration, not guaranteed availability.

## Verification
Focused agent-loop and web-provider suites pass; live Bing smoke returned normalized HTTPS sources without credentials.
