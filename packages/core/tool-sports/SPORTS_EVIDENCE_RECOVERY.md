# PHOENIX Sports Intelligence · research evidence recovery

## Source inventory (verified discovery is NOT a live adapter)

| Evidence | Source / supported public route | Runtime status | Admission rule |
|---|---|---|---|
| NBA/NFL fixture, status, final box scores | ESPN Site scoreboard, summary, team schedules; public but unofficial | Integrated | Both teams, league, date and exact eventId required |
| NBA regular-season game form | ESPN monthly/daily historical scoreboard; teams schedule fallback | Integrated; season guard added | `season.type === 2` or equivalent explicit REG; each event strictly before tipoff; no preseason or playoffs |
| NBA advanced ratings / pace / four factors | NBA.com/stats/teams and public NBA Live CDN per-game boxscore; some routes can block | Planned automated fallback | 2026-27 regular-season period, verified games only, standardized per-100-possession definition, sample size |
| Official NBA injuries | https://official.nba.com/nba-injury-report-2026-27-season/ links PDF releases at ak-static.cms.nba.com | Catalog only; **PDF extraction NOT integrated** | Matchup, full team, player ID/name, `Out/Questionable/Available`, PDF publication time, observedAt; report not submitted => unknown |
| NBA current roster/player game log | ESPN Site / Common v3 athlete ID and roster | Integrated partial | Current team ID and event date; a roster member is NOT a confirmed starter |
| NFL regular-season schedule and form | ESPN Site monthly archive, daily retry, team schedules | Integrated; deprecated date-range route replaced | `season.type === 2`; kickoff cutoff; deduplicate event IDs |
| NFL EPA/success, QB CPOE, pass rush | https://github.com/nflverse/nflverse-data/releases; nflreadr (released play-by-play datasets) | Planned; **NOT wired into investigator** | Explicit REG plays, no post-kickoff lookahead, minimum sample and QB identity |
| NFL inactives and weekly injuries | https://www.nfl.com/injuries/ , https://www.nfl.com/inactives/ and verified club sites | Official manual follow-up; not automated | Distinguish practice/injury designation vs final inactive, reported ~90 min before kickoff |
| Weather NFL outdoors | Open-Meteo plus ESPN verified stadium | Partially integrated | Check dome/roof first; source observation as of kickoff |
| Sportsbook moneyline | Existing ESPN public reference / authorized provider connector | Mixed; event-dependent | True price, house, market, period, two sides, publishedAt; not a proof of winning |
| NHL / MLB / Soccer / Tennis | See sports-research-coverage.ts | Existing specialized modules | Same as-of cutoff and sport-specific completeness, never auto-promote unknown |

## Diagnosis confirmed in code on November 9, 2026

- `nba-research.ts`, `basketball-evidence-dossier.ts`, `multi-sport-research.ts` consumed completed games without validating the ESPN season type.
- `nfl-evidence-research.ts` used `scoreboard?dates=YYYYMMDD-YYYYMMDD`; the repository already documents that ESPN date-range retrieval failed from Sep 2026.
- NBA/NFL specialist tools intentionally refuse a pregame investigation for an already started game; this protects predictions from hindsight, but does not provide a separate **as-of replay**. Never use postgame data to claim pregame evidence.
- NBA official injury PDFs, NBA advanced stats, NFL nflverse PBP and NFL official inactives are not wired as complete automatic evidence. Do not report their mere catalog presence as successful ingestion.

## Implemented first-pass repairs

1. `sports-regular-season.ts`: strict season classification for NBA/NFL archived form. Unknown and conflicting metadata are excluded instead of silently mixed with preseason.
2. NBA slate, NBA/WNBA specialist and multi-sport candidate form use the same season guard.
3. NFL specialist uses shared monthly/dated/team-calendar archive reader and reports partial source coverage when applicable.
4. Provider matrix marks official NBA PDF / advanced NBA metrics / nflverse PBP as **planned** instead of usable.

## Next acceptance gates, not yet claimed complete

A. **NBA official injury parser:** read the official listing, select the latest PDF published before the analysis cutoff, extract only text-verified rows, reconcile exact matchup/team/athlete, store timestamped status and change events. If PDF is missing or the club says NOT YET SUBMITTED, return `unknown` and never fake `healthy`. Validate against 2026-11-09 CLE@CHA, WAS@DET, SAS@PHX and NOP@GSW with morning/evening state changes.

B. **Efficiency engine:** combine current-season ESPN/NBA game logs or an authorized advanced-stats endpoint; calculate ORtg/DRtg/Net/Pace, Four Factors and home/away forms on only `REG` contests before kickoff. Cross-check against published source rankings. `0` is a valid measurement only with actual possessions, not for missing data.

C. **NFL EPA + inactive engine:** import published nflverse weekly releases with event/team/player reconciliation, aggregate EPA/play and success by offense/defense, verify current QB identity, and parse NFL.com inactive reports. Preserve data freshness and fallbacks; no attempt to bypass blockers.

D. **Immutable pregame snapshot / replay:** at `T-24h`, `T-4h`, `T-90m`, `T-15m`, write immutable `observedAt`, `publishedAt`, `eventId`, `gameStart`, `sourceURL`, `sha256`, `seasonType`, `lineupStatus`, `reportVersion`, `marketVersion`, `missingReasons`. Retrospective reviews read snapshots only. If no snapshot exists, say pregame state cannot be reconstructed reliably.

E. **Hard selection gate:** every selected leg must contain evidence both for and against, event identity, regular-season form, two-sided health/availability status, key matchup, opponent, rest/travel, actual source links/time and market independent confidence. Absence of medical status or QB1 => `conditional` and no assertion of complete specialist research. Missing price => research-only; no ROI or bookmaker odds. A target of 5/6 legs never overrides critical missing evidence.

F. **Regression matrix:** test all five Nov 9 NBA/NFL matchups, mixed preseason/regular-season, missing season tag, injury flip from Questionable to Available, missing PDF, late kickoff, archived ESPN outages, NFL home/away and capped network quota; run Node tests, TypeScript typecheck and dedicated PR CI on Linux/Windows. All claims must show pass/fail and exact source date.

## Working definitions
- `verified`: observed from the named endpoint with exact event and historical cutoff.
- `partial`: some fields observed; lack/age of others explicitly listed.
- `planned`: source known, integration/tests not complete.
- `historical audit`: only original timestamped snapshots can prove what was available when a pick was placed.
- A confidence percentage is not a calibrated win probability without proper backtest and calibration.
