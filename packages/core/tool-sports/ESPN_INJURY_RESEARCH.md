# ESPN injury backup for PHOENIX / Kira (2026-11-08)

## Why this exists

An NBA injury page rendered in a desktop browser may not be directly machine-readable in PHOENIX. ESPN has a separate **unofficial public JSON** feed used for injuries. Example: https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries . Human reference page: https://www.espn.com.do/basquetbol/nba/lesiones . The web page may show a JavaScript/CAPTCHA interstitial; the JSON feed is the preferred machine-oriented option but can also be unavailable.

Supported leagues: basketball/nba, basketball/wnba, football/nfl, baseball/mlb, hockey/nhl. For a known ESPN scoreboard event, the backup obtains the numeric IDs of BOTH teams, checks identity, requests /teams/{id}/injuries where available, and falls back to the league-wide /injuries feed. Other leagues including soccer are UNSUPPORTED rather than silently reported healthy.

Each athlete observation preserves team, athlete, numeric ESPN ID if published, raw status, report time, description, expected return if present and source URL. The response includes source timestamp and the team's match status. A stale timestamp becomes stale (not verified). A team absent from the list never implies zero injuries. 'Active' never becomes 'Out'. An ESPN injury entry alone never proves the actual game-day availability, the official active/inactive list, NBA starting five, NFL QB, or NHL goalie.

Cross-check NBA's team-published, continuously updated official report: https://official.nba.com/nba-injury-report-2026-27-season/ . That web page includes downloadable reports; PHOENIX provides the source for manual validation and does not claim to have read an inaccessible PDF. Operator opt-out: PHOENIX_SPORTS_ESPN_DISABLED=1.

Kira tool: sports_chat_espn_injuries. The specialist ticket audit automatically adds what the ESPN feed actually returned for NBA/WNBA/NFL/MLB/NHL. If the feed is blocked or stale, preserve a conditional research ticket when exact matchup, descriptive history and genuine same-bookmaker prices are already verified. Never fabricate a diagnosis, market, availability, or approval.

## What the 2026-11-08 ticket investigation said was missing

- NBA: official injury report, five confirmed starters per club, on/off or pace/efficiency, validated matchups and real timestamped sportsbook quotes. The Odds API v4 returned HTTP 401, ESPN odds were absent/undated, and OddsHarvester rejected the basketball `moneyline` market in that attempt. A 401 or unsupported market is an integration/configuration error, NOT evidence the sport is unquotable.
- NFL: verified starting QB, the inactive list, two full units' starters, OL/pass-rush matchup and weather; quotes must be linked to the correct event.
- NHL: confirmed starting goalies for both sides, form and goalie-specific xG/GSAx, lineup scratches and current line-specific odds, including OT/60-minute market differences.
- Soccer: ESPN player roster sometimes existed while gamelogs, splits, squad depth, team statistics, xG, latest injuries and market odds did not. A historical query using a single `dates=YYYYMMDD-YYYYMMDD` token returned ESPN HTTP 400; date-scoped scoreboard calls are required.
- MLB: probable starters and expected lineups, bullpen workload, park and weather, injury report, exact innings/settlement rules and actual bookmaker lines.
- Tennis: ATP/WTA discovery had zero games on the target date, which must not be converted into fabricated match IDs.

## Highest-value remaining engineering work

1. Verify in deployed runtime that the JSON injury endpoints return correct seasonal data and that the teams actually match the ESPN event. The deterministic tests are not a live feed availability guarantee.
2. Correct the OddsHarvester basketball market map (`moneyline` was rejected in the recorded incident), and diagnose The Odds API credential errors without exposing keys.
3. Confirm all ESPN historical scoreboard requests are date-scoped, not invalid range syntax. Repair missing player stats with bounded backup feeds rather than dozens of redundant failed calls.
4. Separate 'candidate produced' from 'line and specialist evidence complete' and preserve red/conditional missing-data labels. Never guarantee a winning parlay.

Test with: node --experimental-strip-types --test packages/core/tool-sports/tests/espn-injury-backup.test.mjs .
