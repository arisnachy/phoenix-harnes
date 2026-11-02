# Agent Note: Codex quota survives warmup and keeps reset countdowns

Status: implemented

English | [中文](2026-09-23-codex-quota-persistent-countdown.zh.md)

## Problem

The Settings footer can recognize a connected Codex account before native `account/rateLimits/read` finishes, especially while Codex performs its state-database startup or backfill. After a page or host restart the component-level cache is empty, so the footer falls back to a generic `Codex …` seat and temporarily loses the explicit 5h/7d windows. The collapsed rail also omits the reset countdown even when native telemetry includes `resetsAt`.

## Decision

`CodexQuotaRemaining` keeps the last validated quota snapshot in versioned browser storage in addition to the existing connection-scoped memory cache. A restarted page immediately restores the last 5h/7d percentages and their native reset timestamps while the authorization RPC refreshes in the background. A confirmed Codex disconnect clears both caches. If no valid snapshot has ever been observed, a connected account renders explicit 5h and 7d loading seats instead of collapsing to a generic Codex label; loading seats never invent percentages or reset times.

The one-second reset clock now runs for both expanded and collapsed sidebar presentations. The collapsed rail renders the same native reset countdown text as the expanded Settings footer, using compact typography and no progress-bar chrome.

## Alternatives considered

**Keep only the in-memory WeakMap.** Rejected: it survives slot remounts but not a browser reload or host restart, which is exactly when native Codex startup can delay fresh quota telemetry.

**Invent 100% after a reset or while telemetry is unavailable.** Rejected: Phoenix must display provider telemetry, not infer quota capacity.

**Hide the windows until fresh telemetry arrives.** Rejected: it recreates the disappearing-counter regression and removes the user's only indication that Phoenix is still warming the Codex account bridge.

## Consequences

The last real quota remains visible through Phoenix/Codex startup delays, including the remaining time until each reset. Fresh native telemetry replaces the stored snapshot as soon as it arrives. Logout cannot leave a stale quota behind. When Phoenix has no prior trusted snapshot, users see 5h/7d placeholders with an explicit loading reset marker rather than fabricated usage.

## Testing

The focused component suite now covers collapsed 5h/7d reset countdowns, explicit warmup seats, in-memory remount continuity, and persisted reload continuity while the native authorization request is still pending. CI remains responsible for the assembled browser and full client coverage gates.
