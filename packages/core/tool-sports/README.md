# @phoenix-ai/dsh-tool-sports

English | [中文](README.zh.md)

Native chat-only sports tools for Kira: sports_chat_catalog, sports_chat_discover, sports_chat_games, sports_chat_mlb_pitchers, sports_chat_odds, and sports_chat_ticket. Sports questions use the existing conversation, not a menu. The assistant receives attributed data and declarative sports_game_card or sports_ticket_card blocks to show inside validated generative-ui fences.

## ESPN Core / historial de cuotas

Manual de las 14 rutas, movimiento, históricos y procedimientos de Kira: [ESPN_HISTORICOS.md](ESPN_HISTORICOS.md). El recuperador por fecha usa sports_chat_espn_historical_odds y nunca mezcla cuotas antiguas con apuestas vigentes.

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

## Universal matchup factors (evidence-first)

Use `sports_chat_matchup_factors` with the **verified ESPN** `sport`, `league`,
`eventId` and `date` (YYYY-MM-DD). No separate screen: the result includes a
`sports_espn_dashboard` chat component plus an auditable JSON factor report.

- Bounded 3–28-day ESPN scoreboard history: last 10 completed games per team,
  wins/losses, scoring for/against, rest, up to five head-to-head results and
  same-stadium samples **only where ESPN identifies the venue**.
- MLB: independently sourced probable pitchers and recent verified pitching
  starts when MLB StatsAPI provides them. First 3, first 5 and first 9 inning
  totals are **simple descriptive scenario baselines**, requiring at least
  three valid team samples per period; not calibrated predictions.
- Existing ESPN context is reused for rosters, news and injury reports.
  Current weather is optionally sourced from Open-Meteo (CC BY 4.0; check\n  commercial API licensing) **only when venue coordinates occur in ESPN**.\n  It remains a forecast, not a quantified causal scoring adjustment.\n  Rotations, current starters, wind/sun causal impact, roof configuration, bullpen fatigue,
  opponent-adjusted metrics and sport-specific advanced factors are explicitly
  marked unverified unless separately supplied by a verified source.
- Bookmaker outcomes must match both teams AND game time and remain current
  before reporting them. Their no-vig shares are pricing context, NOT model
  win probabilities. Never compare a 3- or 5-inning baseline to a full-game
  sportsbook total; period, extra-innings rules and source must agree.
- Never report an expected betting edge, win percentage or guaranteed
  favorite without a separately trained, calibrated and backtested model.
  Missing sources stay missing, rather than becoming zero or a favorable
  indicator. Data and UI are bounded and source-attributed.

Run:
`node --experimental-strip-types --test packages/core/tool-sports/tests/universal-matchup-factors.test.mjs`

## Real sportsbook markets, quotes and tracking (2026-10-29)

Kira's sportsbook workflow separates **researched picks**, **observed current commercial
quotes**, **bookmaker-accepted bets**, and **operator-settled outcomes**. A price is
not placement: do not call a real quoted ticket fictional, but NEVER label a ticket
accepted without independent operator evidence. Tool `sports_chat_ticket` filters
out expired/unattributed quotes, and `sports_chat_ticket_evidence_priced_auto` matches
bookmakers and selected fixtures. The native `sports_ticket_card` has a live
stake input in RD$, potential gross return and **net profit**. This input does not
submit or transfer money. Quotes may be withdrawn, changed or rejected.

Kira can call `sports_chat_bet_rules` for the multi-sport market dictionary
(moneyline, run line -1.5/+2.5, team/full-game totals, first 3/5 innings,
player props, soccer 1X2/Asian handicap/BTTS, NBA quarter totals, NFL passing
yards, hockey puck line and shots, tennis sets/games, golf, MMA, cricket).
This is an **ontology**, not proof that all products are for sale now. An
actual offer requires **bookmaker, event, period, line, player, price and
timestamp** from the authorized source. Same-game parlays and correlated
selections may require bookmaker-provided *combined prices*.

`sports_chat_ticket_track` retrieves ESPN's official scores for a known
date/league and IDs and computes a **provisional** won/lost/push/pending/
unverifiable status for supported game markets. It handles run line, spreads,
moneyline, 1X2, team totals and first 3/5 inning totals; it does NOT infer
player-prop outcomes from team scores and does not handle settled winning
receipts, payouts, Asian quarter-line half-win/half-loss, early cashouts,
rescheduling or provider-specific settlement without operator confirmation.
This is on-demand: continuous background monitoring requires connecting a
persisted-ticket ledger and scheduler. Matching a user-entered folio does
not prove the sportsbook accepted it.

### PRIMARY Dominican bookmaker sources (verified)

- **Juancito Sport official rules**:
  https://www.juancitosport.com.do/reglas/
  Baseball moneyline/run line require losing team to bat fifth inning;
  full-game totals/individual team runs require losing team to bat ninth;
  first 3 inning markets require 3 complete innings; first 5 inning O/U
  requires 5 full innings. Player hit bases: single=1, double=2,
  triple=3, HR=4. Soccer is 90 minutes plus stoppage, not extra time.
  Asian handicap **quarter** lines yield partial wins/refunds/losses.
- **Official Juancito terms**:
  https://www.juancitosport.com.do/banca/terminos/
  Electronic **"Apuesta Confirmada"** acceptance is required (8.4);
  minimum stake RD$100 (7.10); posted maximum parlay winnings
  RD$15,000,000 (4.9). Section 6.6 explicitly prohibits using bots or
  scripts to place bets. **PHOENIX must not automate bookmaker placement
  at Juancito**; a user must place the bet via its authorized UI. Rules,
  limits and available products can change. Do not quote the independent
  `juancitosports.com` promotional site as the official house rules.
- Other domain-specific house rules, **not transitive to Juancito**:
  https://www.appuesta.do/rules
  https://www.facilitobet.com/regla/beisbol
  https://sportsbook.draftkings.com/help/sport-rules/baseball
  https://policies.fanduel.com/SB/NJ/2026-10-15T12-42-58.html
- Dominican authority:
  https://www.casinos.gob.do/juegos-autorizados/banca-de-apuestas-deportivas/

To verify:
`node --experimental-strip-types --test packages/core/tool-sports/tests/sports-bet-settlement.test.mjs`.
These are **outcome checks**, not profit guarantees. Backtests should use
time-held-out samples, real bookmaker prices available before kickoff,
sport-specific metrics, injury/team availability, correlation guards,
and calibration assessments before publishing a quantitative edge.


### Comprehensive odds access and validation by discipline

The `sports_chat_odds_scan` read-only tool examines all eleven OddsHarvester
sport categories in three bounded pages: `offset=0`, `offset=4` and
`offset=8` (each `limit=4`). The returned `unprobed` and
`nextOffset` values prevent a partial scan from being called complete.
Coverage includes soccer, basketball (NBA and WNBA), baseball, American
football, ice hockey, tennis (ATP and WTA), handball, volleyball, rugby
league, rugby union and cricket. A league listed as supported is **not
evidence** that a bookmaker has quoted an event.

`sports_chat_odds` checks explicit league keys and separately queries
available ESPN, OddsHarvester and API feeds. A sport-wide OddsHarvester
result is never relabeled as NBA, WNBA, MLB, NFL, NHL, ATP or WTA without
upstream league evidence. For soccer, the country/league path must match
when league names are ambiguous. Tennis totals use
`total_games_over_under` or `total_sets_over_under`; volleyball uses
`total_points_over_under` or `total_sets_over_under`, rather than the
unsupported generic `over_under` token.

If OddsHarvester exits unsuccessfully, Kira receives a **redacted**
diagnostic including `category`, `exitCode`, `signal`, `killed`
and the useful stderr tail. Categories distinguish missing executable,
Playwright Chromium not installed, timeout, site challenge and other
scraper errors. If rows were read but none are eligible, Kira explains
the exact-market, bookmaker, kickoff and timestamp requirements rather
than silently treating a present executable as a live odds connection.

To verify the orchestration:
`node --experimental-strip-types --test packages/core/tool-sports/tests/sports-odds-coverage.test.mjs`.
Only a genuine quote with source, bookmaker, event, market, period,
price and observed time is evidence of real access. Source installation
and CI success do not prove the user's Windows system can connect to
OddsPortal.

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

### ESPN per-game odds by event ID, date and independent routes

`sports_chat_odds` now defaults to **ESPN only** (`sourcePolicy=espn`),
using Site Scoreboard → same-event Core `$ref` odds → Summary/Pickcenter.
`sourcePolicy=all` is an explicit opt-in to independent bookmakers when
no ESPN `eventId` or `date` is selected. Quoted event IDs from other
providers must never be treated as ESPN event IDs. If no current ESPN
prices can be verified, the tool reports diagnostics rather than silently
substituting another operator's prices. Supported league coverage varies.

Kira can request `sports_chat_odds` with `sportKey`, a verified
`eventId` from `sports_chat_games`, and the local `date`
(`YYYY-MM-DD`). The collector validates the date and event ID, reads
the matching ESPN scoreboard, then attempts the same competition's
ESPN Core odds collection (following a bounded set of ESPN-only
`$ref`s) and the Site API summary/pickcenter if needed. No other
game's odds are substituted for the requested event. Quotes identify
the source route (`scoreboard`, `core` or `summary`), sportsbook,
selection, market, line and dated update. Prices with no verified
timestamp, a stale update or an already-started kickoff cannot become
an advertised **current pregame quote**.

League route examples use `baseball_mlb`, `basketball_nba`,
`basketball_wnba`, `americanfootball_nfl`, `icehockey_nhl`,
`soccer_epl`, `soccer_spain_la_liga`, `soccer_usa_mls`,
`soccer_mexico_ligamx`, `basketball_ncaab` and others in the
allowlist. The ESPN Site and Core endpoints are **unofficial and
subject to breaking changes, coverage gaps and throttling**.
A successful HTTP response is not proof that a sportsbook quoted the
match. Paths are constructed and bounded; untrusted `$ref` hosts
are not fetched. Short in-process caches and request caps reduce load.

For individual sportsbook provider records, line movement and
historical market data, Kira must call `sports_chat_espn_core` with
`mode=odds`, `provider` or `movement` using a real ESPN event ID.
Other Core modes include `ats`, `odds_records`, `futures`,
`probabilities` and `predictor`; the latter are **not** live
prices. Provider IDs are discovered from ESPN's current catalog; do
not hardcode illustrative provider IDs as universal or stable.

Regression test:
`node --experimental-strip-types --test packages/core/tool-sports/tests/espn-odds-multiroute.test.mjs`.
