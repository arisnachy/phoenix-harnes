# PHOENIX Sports: redundant public odds and independent predictions (2026-11-08)

This catalog distinguishes **current sportsbook quotes**, **independent model fair odds**,
**historical datasets** and **API directories**. A working website is not a verified
machine-readable price feed. Never generate a parlay from a model's fairOdds.

## Connected quote adapters

| Source | Access | Transport | Scope | Host configuration |
| --- | --- | --- | --- | --- |
| ESPN Site/Core | Public unofficial JSON | Already integrated | Pregame sportsbook rows *only when provider and updatedAt are present* | Enabled unless PHOENIX_SPORTS_ESPN_DISABLED=1 |
| OddsHarvester | Locally installed CLI / authorized website access | Already integrated | Supported sports/markets; site availability and publisher terms vary | PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED=1 |
| The Odds API v4 | Free limited credits; own key | Already integrated | Live pregame markets by bookmaker | THE_ODDS_API_KEY |
| TheOddsAPI | Separate free key/market limits | Already integrated | Limited moneylines on free tier | THEODDSAPI_API_KEY |
| TheRundown V2 | Free key, 5-min delayed prematch moneylines/spreads/totals, 3 sportsbooks | **New adapter** | NFL, NBA, MLB, NHL, WNBA, MLS, EPL, supported soccer leagues | THERUNDOWN_API_KEY |
| SportsGameOdds V2 | Free Amateur with key and plan limits | **New adapter** | NFL, NBA, MLB, NHL, WNBA and supported soccer leagues | SPORTSGAMEODDS_API_KEY |

Authoritative provider references:
- https://therundown.io/blog/sports-betting-odds-api — events > markets > participants > lines > per-affiliate prices; header X-TheRundown-Key.
- https://therundown.io/docs/quickstart — 20,000 points/day, 200,000/month, one req/sec, 5-minute delay on Free.
- https://sportsgameodds.com/docs/endpoints/getEvents — events, status.startsAt, teams, odds.byBookmaker, lastUpdatedAt.
- https://sportsgameodds.com/docs/basics/setup — x-api-key, Amateur key (credit card may be required).
- https://the-odds-api.com — limited free credits; x-api-key is **not** the credential for this provider.
- https://theoddsapi.com/docs — different API from The Odds API v4.

The two new adapters are **optional until a legitimate key is saved**. The PHOENIX host
resolves the new secrets from the existing credentials vault per request. Do not paste
credentials in chat, source control, URLs, or ticket UI. New provider keys require
explicit account enrollment by the operator, which this code cannot bypass.

## Free, open independent model (NOT a quote provider)

**Bet Better Open Model API**: https://betbetter.world/api/
- No key, CC BY 4.0, required attribution.
- Examples: https://betbetter.world/nba/picks?format=json&free=1
  and https://betbetter.world/nfl/picks?format=json&free=1 .
- Provides modelProbabilityPct and fairOdds = 100 / modelProbabilityPct,
  **not** sportsbook prices. Locked picks are unusable.
- Predictions may be compared with researched picks as a second opinion,
  including contradictions, but cannot satisfy bookmaker quote validation.
- All output is identified as model-probability and attributed to Bet Better.
- Caching: source suggests 15 minutes; avoid aggressive polling.

## References that are NOT live quote APIs by themselves

- https://github.com/api-evangelist/sportsbook-api — third-party directory
  describing Sportsbook API; it does not stream odds.
- https://sportsbookapi.com — separate commercial API described by that directory.
  Verify its current authorization and entitlement before creating an adapter.
- https://odds-api.io/es/pricing/free — historical free keys; new free accounts
  may be unavailable. Never silently scrape paid endpoints.
- https://www.football-data.co.uk/downloadm.php — historical soccer odds CSV;
  NOT current bookmaker offers.
- https://github.com/DanielTomaro13/sportsdata-mcp — optional MIT multi-provider
  aggregator; running a third-party MCP locally requires code/security review
  and opt-in. Its integrations may have separate keys or publisher restrictions.
- https://github.com/jordantete/OddsHarvester — CLI, not a public sportsbook API.

## Required per-leg gating (remains mandatory)

1. Verified real pregame fixture: league, BOTH team identities, start time and provider event ID.
2. Mandatory sport specialist dossier (NFL QB/inactives, NBA rotations/injuries,
   NHL starter goalie/xG, MLB pitchers/bullpen, Soccer lineup/xG, Tennis surface/fatigue);
   missing critical evidence must be exposed as missing, not invented.
3. Independent model opinions are supplemental. A model disagreement is preserved.
4. Match the **exact** market, selection, point, period, bookmaker and scheduled fixture.
5. Accept fresh, timestamped, open prices only. An API returning HTTP 200 with an
   empty slate is not proof that all other sources have no markets.
6. Preserve book identity: do not combine different sportsbooks into a quoted parlay.
7. Keep outcome and expected-value claims explicitly uncalibrated unless an
   independently validated predictive model is available. A five-leg ticket can lose.

TheRundown Free provides delayed—not truly live—odds. Check redistribution/display
rights: Free is for evaluation/personal/internal use; commercial end-user display
can require an upgraded license. SportsGameOdds requires acceptance of its
independent terms. No automated wagers or circumventing blocks.

## Regression checks

`node --experimental-strip-types --test packages/core/tool-sports/tests/open-odds-providers.test.mjs`

The CI Daily Ticket Intelligence workflow executes these checks together with
sport specialist and 5/6-leg consistency checks. Configured, observed, empty,
authentication failure and unavailable should remain distinct.
