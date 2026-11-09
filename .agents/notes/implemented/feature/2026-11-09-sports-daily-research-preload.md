# PHOENIX daily sports research cache — 2026-11-09

## Problem
ESPN ticket candidate scouting and per-sport specialist research can repeat expensive network calls after app restart. Existing public-source cache and quota counters are largely process-local.

## Decision
Introduce a short-lived, disk-backed research-only GET cache with seven-day retention, atomic writes, file locks and 10 MB/day cap. Cache individual data for minutes/hours, never treat the seven-day retention as facts being valid for seven days. Bookmaker odds never use this cache. Keep specialist research and approval criteria intact.

Read-only, bounded automatic preflight covers public ESPN schedules, NHL Web API, MLB StatsAPI and TheSportsDB. With private keys, it can additionally warm selected API-Football league/date queries, API-Hockey, API-NFL and Big Balls. Provider access/season and field coverage are never presumed from an endpoint existing.

API-Sports requests are limited by persisted UTC-day counters per API and credential fingerprint. Defaults: 80 of the 100 daily advertised requests (reserve 20) and 9/minute. Response headers and 429 cooldown are honored. No credential is written to disk or exposed in model output. Local locks do not coordinate different computers.

Kira gets a status/preload tool and an optional automatic preflight while the app is running. No worker can refresh data when the PC/app is shut down. An external OS scheduler would be required for that.

SportsDataIO trial returns scrambled data and is excluded from real forecasts. Sportmonks free scope is league-specific. NFLMeta data/plan are not asserted live or official inactive lists. Player roster position does not confirm goalie, QB or player starts.

## Verification
Linux/Windows CI targets cache reuse, API-Sports budget, secret isolation, quote exclusion, and seven-day pruning. Forecast calibration, historical betting value and end-to-end data completeness are separate matters.