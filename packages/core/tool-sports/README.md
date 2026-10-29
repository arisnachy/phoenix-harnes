# @phoenix-ai/dsh-tool-sports

English | [中文](README.zh.md)

Native chat-only sports tools for Kira: sports_chat_catalog, sports_chat_discover, sports_chat_games, sports_chat_mlb_pitchers, sports_chat_odds, and sports_chat_ticket. Sports questions use the existing conversation, not a menu. The assistant receives attributed data and declarative sports_game_card or sports_ticket_card blocks to show inside validated generative-ui fences.

## Provider access

ESPN Site/Core and MLB Stats are queried as publicly reachable read-only sources without needing an API key or a PHOENIX_SPORTS_ESPN_ALLOWED setting. Operators may opt out using PHOENIX_SPORTS_ESPN_DISABLED=1 or PHOENIX_SPORTS_MLB_DISABLED=1; public access does not grant a license to reuse data. THE_ODDS_API_KEY selects the existing `api.the-odds-api.com` v4 adapter, with its own quota and license. Separately, `THEODDSAPI_API_KEY` selects the optional `api.theoddsapi.com` adapter, which publishes a free NBA/MLB moneyline tier (registration and a key still required); **these are independent services, credentials and JSON schemas**. If both keys are present the original v4 adapter takes priority; without either, PHOENIX tries published ESPN moneylines. The free adapter uses a fixed HTTPS host, a server-only `x-api-key` header, a bounded response and a 90-second per-account cache. No provider key is written into the URL or a rendered card. If missing, ESPN Core/Site moneyline quotes are read when available, but no absent prices or missing markets are fabricated. PHOENIX_SPORTS_ESPN_IMAGES_ALLOWED=1 is an additional opt-in after media rights review. Credentials stay in the host environment and never appear in tool output. Only fixed hosts can be queried.

## NBA research (source-derived, not calibrated)

`sports_chat_nba_research` reads recent NBA final scoreboards once per date (shared across the slate), computes actual wins, average margins and approximate hours since the previous game, and records archive coverage. `sports_chat_ticket_research_auto` now rejects NBA candidates that have insufficient completed-game evidence. These are descriptive trends **not** win-probability estimates or edge calculations. Official NBA injury reports, roster validation, advanced efficiency metrics and true calibrated model-based predictions remain separate integration requirements; unverified NBA player leaders are temporarily hidden.

## Keyless multi-sport sources (optional)

The three no-key GitHub projects have DIFFERENT roles. They are **not three interchangeable sources of live lines**:

| Source | Role | Sports | Current price? |
| --- | --- | --- | --- |
| [OddsHarvester](https://github.com/jordantete/OddsHarvester) v0.20.0 (MIT) | Browser scraping of OddsPortal pregame odds and public community opinions; Playwright | 11, depending on site coverage | Possible, **not guaranteed** |
| [sportsbookreview-scraper](https://github.com/flancast90/sportsbookreview-scraper) (MIT) | Historical SportsBookReview closing prices and score outcomes for backtesting | NBA, MLB, NFL, NHL (mostly 2011-2021) | **No** |
| [mlb-odds-scraper](https://github.com/ArnavSaraogi/mlb-odds-scraper) | MLB bookmaker-specific historical prices for backtesting | MLB, published dataset 2021-2025 | **No** |

Running without an API key does NOT mean unlimited calls or redistribution rights. Publisher terms, anti-automation restrictions, site availability, geolocation and rate limits apply. PHOENIX never bypasses authentication, CAPTCHAs or blocks. Always check access rights before enabling scraping. Historical prices never appear as current ticket odds.

### Explicit isolated bootstrap

On a system with Node 22+, Python 3.12+ and Git, run:

```sh
pnpm sports:sources:bootstrap
```

The script installs OddsHarvester **in its own Python environment**, installs its Chromium browser, clones the two public historical-source projects and downloads the MLB history release. It creates `~/.phoenix/sports-sources/phoenix-sports-sources.env`. Review that file and apply its three variables to the PHOENIX host, then restart; the script does not silently modify system settings or run on startup.

- `PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED=1`: explicit operator opt-in.
- `PHOENIX_SPORTS_ODDSHARVESTER_BIN`: absolute path to the installed CLI.
- `PHOENIX_SPORTS_HISTORY_DIR`: absolute path to the downloaded archival JSONs.

The optional CLI has a bounded timeout, fixed arguments (never a user URL), request deduplication, 5-minute cache and 1-hour freshness cutoff. Withdrawn prices are excluded. Without the keyless source, PHOENIX still tries already configured ESPN public moneylines. If both sources fail, no current quote can be claimed.

### Three-source research workflow

- `sports_chat_research`: source-attributed ESPN recent results for every sport/league in the existing catalog, descriptive W/L/D, margin and rest; no fabricated predictive probability.
- `sports_chat_odds_keyless`: current public market observations with bookmaker, period, outcome, capture time and price. The scraper CLI and website must work.
- `sports_chat_historical_odds`: imports both independently collected SportsBookReview historic datasets (MLB gets two); **backtesting only**.
- `sports_chat_community_opinions`: top publicly voted picks from OddsPortal Community, separately labeled **crowd opinion, not a calibrated probability**.
- `sports_chat_ticket_evidence_auto`: preselects exactly 5 or 6 verified upcoming independent matches (or an explicit incomplete draft) using completed historical games across available leagues and a **descriptive score only**, never a fabricated win probability.
- `sports_chat_ticket_evidence_priced_auto`: same research, then quote fresh pregame markets after exact event/date/team matching; computes combined decimal price **only when the same bookmaker offers every leg**. Missing, stale, withdrawn or mismatched prices make the ticket unpriced. No real wager is placed.

For MLB retain `sports_chat_mlb_pitchers` and official MLB Stats API. For football/soccer use 1X2, BTTS, double chance, team form and lineups; tennis needs surface and match fatigue; NBA requires injury and matchup analysis; NFL requires quarterback/roster; NHL requires confirmed goalkeeper. Missing advanced data is explicitly unresolved; this integration **does not implement a validated betting model or guarantee a winning 5/6-leg ticket**.

## Model Experience

### Verified sports fixtures and inline cards

#### What the model sees

Kira receives bounded `sports_chat_games` results containing attributed fixture data and declarative `sports_game_card` payloads with local time, teams, source, and optional verified pitcher, lineup, and bullpen information. `sports_chat_odds` may supply real quoted markets; `sports_chat_ticket` only simulates a ticket.

#### Token effect

Each sports request contributes only source-attributed event fields and bounded visual-card payloads to the model context; absent player statistics and prices remain absent rather than becoming synthetic tokens.

#### KV Cache effect

Live fixtures and odds can change between requests, so dynamic tool results may alter the request prefix and reduce KV-cache reuse; stable static tool schemas and instructions remain cacheable.

## Known Limitations and Deferred Work

- ESPN's public endpoints are unofficial and can change or stop responding. Provider terms and image redistribution rights require independent review.
- Favorites are descriptive standings trends, not calibrated win probabilities or promised winners; missing evidence does not justify a pick.
- A bookmaker price can be displayed only when its source supplies it. No bet is placed, and no direct bookmaker transaction is supported.
- First-party sports tools expose validated UI cards automatically; unsupported data and malformed schemas cannot render a card.
- Some disciplines lack player-by-player comparisons, confirmed lineups, or bullpen details. An unavailable value must be shown as unavailable.


## ESPN Universal Intelligence — adaptive native chat

The read-only tool **sports_chat_espn_explore** complements, without replacing,
sports_chat_games for scoreboards and sports_chat_odds for verified bookmaker prices.

| View | Required input | ESPN sources | UI |
| --- | --- | --- | --- |
| search | query | ESPN Search v2 | Entities by name with verified ID navigation |
| team | teamId | Site v2 team, roster, schedule, news, stats, record, transactions | Crest, roster with photos, player status, results, headlines |
| player | athleteId | Core v2 profile; Common v3 overview, stats, gamelog, splits | Portrait, KPIs, match logs and situational stats |
| event | eventId | Site v2 summary; Core v2 odds, probabilities and plays | Fixture, final winner flag, leaders, plays and sourced market metadata |
| standings | none | Site standings via /apis/v2 | Team rankings and performance |
| news | none | Site v2 league news | Headline cards with source imagery |
| leaders | none | Common v3 byathlete and Site statistics | Metric and leader sections |

Kira can search by name to discover the real ESPN ID before showing an
individual team/player view. The new **sports_espn_dashboard** has dynamic
metric/list/article sections. Extensibility comes from *data-driven composition*,
not literally infinitely many components. It respects Phoenix's theme and chat width.

Important guards: validated sport, catalogued league and numeric IDs; fixed
allowlisted endpoints and no raw external $ref following; bounded parallel
queries, 4 MB JSON cap, timeout, success/negative TTL cache and capped memory.
Only a final result with an ESPN winner flag can be labelled winner.
An empty HTTP 200, a Core reference to an odds item, a roster entry or
a news headline cannot stand in for verified betting prices, future winners,
confirmed starters or updated injury status. ESPN is unofficial and does
not guarantee coverage, usage limits or redistribution rights.

Run tests:
- node --experimental-strip-types --test packages/core/tool-sports/tests/espn-intelligence.test.mjs
- pnpm exec vitest run packages/client/ui-conversation/tests/sports-rich-ui.client.spec.tsx

Adding a future sport-specific resource should create new validated sections
rather than a separate page or an unbounded set of model-visible tool schemas.
