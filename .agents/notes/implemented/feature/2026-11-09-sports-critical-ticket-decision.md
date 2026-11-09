# 2026-11-09 · Critical second-pass sports ticket decision audit

## Problem
The ticket engine assembled a descriptively strong five/six-leg selection before explaining whether the weakest legs added justified risk. It already produced no-vig shares and 3/4/5 products, but did not generate reproducible decisions to exclude, hold, or seek replacements. That allowed a 52% bookmaker favorite to appear indistinguishable from stronger favorites in the priced display.

## Decision
Add a deterministic, read-only second-pass critic after specialist and bookmaker data collection:
- Screen same-bookmaker, same-event no-vig prices; calculate quote-implied break-even separately.
- Exclude weak implied favorites below a configurable heuristic screen (default 55%, **not a calibrated probability cutoff**).
- Hold candidates with contradictory independent model, missing/partial specialist evidence, missing NHL goalie confirmation or incomplete two-sided market quotes.
- Distinguish conditional candidates from candidates to compare, without ever labeling them approved wagers.
- Publish per-leg reasoning and 3/4/5 market-product scenarios. Do not automatically replace excluded legs with unresearched events or pretend a quote demonstrates positive EV.
- Keep independent Bet Better opinions separate from bookmaker prices and from Phoenix's own calibrated models (not yet available).

The product output now provides a structured 'decisionAudit' both for quoted and unquoted research, and Kira is instructed to explain it before claiming a final ticket.

## Proof obligations
- Focused unit tests exercise an Anaheim-like 52% exclusion, Tampa Bay goalie hold, market risk scenarios, missing no-vig pairs, contradictions, duplicate-event rejection and invalid configuration.
- Existing end-to-end fixture test checks that the per-leg critic appears in the ticket card.
- CI is extended to run this new test file on Linux and Windows with strict TypeScript validation.
- A later chronologically separated sport-specific backtest against no-vig closing lines, Elo/Poisson baselines, Brier/log-loss and calibration plots remains mandatory before asserting improved forecast skill or positive value.

## Operational limits
No guaranteed accuracy, profitable edge, validated EV, bookmaker execution or automated wager placement. 5–6 legs is a requested upper bound, not permission to fabricate missing supporting evidence. The screening thresholds are user/deployment-configurable policy and have not been scientifically optimized.
