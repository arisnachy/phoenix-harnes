# Agent Note: Six-sport daily market shortlist

Status: implemented

## Problem

PHOENIX's daily research surface scanned at most 20 fixtures and normally returned 12. Its priced-ticket tool accepted only four sports keys, defaulted to moneyline and did not reconcile quoted alternatives against a broad verified slate. For a user requesting four to six daily legs, the engine often stopped early or treated the lowest-priced winner as the only candidate.

## Decision

The daily scout returns up to 36 verified future events, preserving its bounded known-league coverage. Kira can request a five-candidate goal (range four to six) with the `sports_chat_daily_market_shortlist` tool. That tool consults the currently configured and authorized real-quote adapters for h2h, spreads and totals on leagues actually present in the scout output. The batch has at most three provider requests in flight and considers at most ten distinct sport keys.

The shortlist compares each market with exactly one ESPN event by discipline, league, canonical team names and kickoff time. Two-sided markets must have matching opposite outcomes and line, and soccer h2h must have a draw option. Only dated and recent pregame quotes are eligible. The same bookmaker must quote every proposed leg; at most one selection per event is returned. Non-winner markets are surfaced alongside winners when available. A request to prepare an actual quoted ticket may now consult up to six sport keys and all three base market categories.

The output labels every result `quote-only-research-pending`. The bookmaker-implied no-vig share is pricing context, not a trained prediction or betting advantage. The analyst must still research injuries, lineups, players, opposition, context and sportsbook rules before defending a final ticket. The system does not place bets.

## Alternatives considered

**Force exactly six selections regardless of coverage.** Rejected because unavailable quotes, started games and partial markets would become invented or misleading bets.

**Compare every market by highest price.** Rejected because high payout is not evidence of expected value and market classes cannot be ranked without market-specific probability models.

**Treat same-game combinations as independent.** Rejected because correlated bets need sportsbook-provided combination prices and rules.

## Consequences

The default discovery budget is larger and a single request can surface up to six independently verified sport-key markets. More provider requests can use paid API credits, so calls are bounded and only leagues with confirmed games are queried. Soccer leagues outside the current scout catalog still require paginated world discovery. Props and period-specific menus require separate authorized event-level adapters; this feature does not pretend to support them already.

The normal path aims for four to six researched candidates, but returns fewer with a concrete explanation when providers lack valid prices. Assertions are pinned by `daily-sports-scout.test.mjs` and `daily-market-shortlist.test.mjs`; integration and live provider performance require separate checks.
