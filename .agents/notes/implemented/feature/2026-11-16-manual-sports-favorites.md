# Agent Note: Independent sports favorites with live status

Status: implemented

## Problem

The scoreboard previously merged receipt-linked tracking and the separate Kira prediction ledger into one visible favorite, leaving no explicit manual choice per game. When both ledgers existed the analytic selection could disappear, and users could not audit their own selections independently.

## Decision

A browser-local user ledger records one team choice by exact ESPN event ID, discipline, league, date, home and away teams. The choice is clearly labeled as a personal favorite, never as a receipt, quote, bet placement or bookmaker settlement. Kira's structured forecasts and actual receipt goals remain separate and can mark the same or opposite sides in the compact two-across chat layout.

Only the exact ESPN event and both team identities authorize live or final grading. The shared grading function uses score-aware states (pending, leading, trailing, won, lost, push, review), shown with small icons and a provisional status label. Stale live scores are not treated as confirmed results. User choices made after kickoff are tracked visually but excluded from prediction accuracy; only pregame selections whose corresponding final has been observed contribute to locally calculated accuracy. Selections cannot be changed after a verified final.

The UI preserves existing `data-selected-favorite`, `data-pick-source` and provisional result labels used by regression checks. The entire feature is opt-in per match and does not request bookmaker credentials.

## Verification

Focused UI checks cover choosing, changing, clearing and reloading favorites; separate Kira and user choices; live and final status; exact event mismatch; and exclusion of live-made selections. The browser-local history is conditional on the viewer loading a verified final, so it is not a complete population-level backtest. CI and device validation are separate from source implementation.
