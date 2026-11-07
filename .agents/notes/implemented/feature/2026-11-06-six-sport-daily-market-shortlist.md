# Agent Note: Six-sport daily market shortlist

Status: implemented

## Problem

PHOENIX's daily research surface scanned at most 20 fixtures and normally returned 12. Its priced-ticket tool accepted only four sports keys, defaulted to moneyline and did not reconcile quoted alternatives against a broad verified slate. For a user requesting four to six daily legs, the engine often stopped early or treated the lowest-priced winner as the only candidate.

## Decision

The daily scout returns up to 36 verified future events, preserving its bounded known-league coverage. Kira can request a five-candidate goal (range four to six) with the `sports_chat_daily_market_shortlist` tool. That tool consults the currently configured and authorized real-quote adapters for h2h, spreads and totals on leagues actually present in the scout output. The batch has at most three provider requests in flight and considers at most ten distinct sport keys.

The shortlist compares each market with exactly one ESPN event by discipline, league, canonical team names and kickoff time. Two-sided markets must have matching opposite outcomes and line, and soccer h2h must have a draw option. Only dated and recent pregame quotes are eligible. The same bookmaker must quote every proposed leg; at most one selection per event is returned. Non-winner markets are surfaced alongside winners when available. A request to prepare an actual quoted ticket may now consult up to six sport keys and all three base market categories.

The first-pass output labels every price `quote-only-research-pending`. With `deep=true`, up to ten or eleven shortlist candidates undergo source-attributed historical, matchup, injury, news and venue research; both quoted market sides are checked against observed scoring/allowing form before selecting a direction. The result is labeled `descriptive-support`, `uncertain` or `unavailable`. Those labels and bookmaker-implied no-vig shares are NOT calibrated probabilities, expected-value estimates or winning guarantees. The analyst must still verify official injuries, starting players and sportsbook settlement rules before proposing a final ticket. When four or more same-bookmaker offers survive the deep check, the operation also emits a native quoted ticket card with exact prices, market lines and per-leg descriptive/conditional notes. It does not claim a profitable parlay, approved bet or verified independent predictive probability. The system does not place bets.

For authorized providers, `sports_chat_event_market_menu` also uses an actual The Odds API v4 event ID to fetch event-level alternative lines, MLB inning markets, basketball/hockey periods and player propositions, preserving athlete description, market, period, point, bookmaker and timestamp. This is a discovery menu, not an automatic predictive model for props.

## Alternatives considered

**Force exactly six selections regardless of coverage.** Rejected because unavailable quotes, started games and partial markets would become invented or misleading bets.

**Compare every market by highest price.** Rejected because high payout is not evidence of expected value and market classes cannot be ranked without market-specific probability models.

**Treat same-game combinations as independent.** Rejected because correlated bets need sportsbook-provided combination prices and rules.

## Consequences

The default discovery budget covers 20 known league endpoints and a single request can surface up to six sport-key markets with independently verified identities and prices. More provider requests can use paid API credits, so calls are bounded and only leagues with confirmed games are queried. Soccer leagues outside the current scout catalog still require paginated world discovery. An authorized event-level adapter discovers additional prop/period menus; independent modeling and exact settlement validation for those markets remain deferred.

The normal path aims for four to six researched candidates, but returns fewer with a concrete explanation when providers lack valid prices. Assertions are pinned by `daily-sports-scout.test.mjs` and `daily-market-shortlist.test.mjs`; integration and live provider performance require separate checks.

The daily research operation now gathers up to ten priced candidate games for five requested legs, or eleven for six. That larger pool is audited and ranked before choosing the final group, without repeating an event. Daily fixtures use Santo Domingo kickoff date instead of relying on the upstream date query alone. Only explicit team-name aliases are normalized, never general fuzzy matching. Additional event markets are first discovered from The Odds API's actual market inventory to reduce wasted quote requests and expose unsupported menu options instead of asserting they exist.
