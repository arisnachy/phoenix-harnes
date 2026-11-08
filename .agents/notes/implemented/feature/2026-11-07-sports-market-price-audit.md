# Agent Note: Sports market price audit

Status: implemented

## Problem

A bookmaker moneyline favorite or NHL +1.5 could appear appealing because a recent form model followed the likely winner, even when its price required an implausibly high success rate. A descriptive margin does not quantify the odds of covering a specific handicap or total. Different available lines within the same market were not always retained for comparison.

## Decision

Keep evidence-first matchup investigation but attach an exact price audit to the selected bookmaker side. The audit reports the break-even percentage, bookmaker no-vig share and overround separately, withholding expected value and model probabilities until an independent estimate is validated out of sample, matches the exact event/market/outcome/line and predates the kickoff. Invalid or insufficient model proof fails closed. Expensive favorites requiring at least 80% success are demoted to uncertain when only descriptive form is available. NHL puck-line restrictions already present remain active. NBA variability is calculated from full historical game totals rather than each team's own points. Retain up to four alternate real lines or market families per researched fixture with the same cached ESPN history.

The daily native card quotes only descriptively supported selections, explains each leg's break-even threshold and never claims calibrated edge. The existing probability calibration service is not a validated total/spread model, and no automatic inference of such a model is performed. Verified prices belonging to other bookmakers cannot be presented as Juancito quotes.

## Alternatives considered

Using the bookmaker no-vig share as an independent winning probability would make every apparent edge circular; rejected. A narrow normal or Poisson fit to ten recent scores would not establish holdout validation; rejected. Including four to six conditional legs to fill a ticket would hide unavailable evidence; rejected.

## Consequences

The operator can inspect overpriced favorites and alternate handicaps before betting. The daily ticket remains a priced research candidate, not a verified profitable recommendation. Independent sport/market calibration and chronologically held-out ROI/CLV auditing remain necessary before allowing positive expected value claims.
