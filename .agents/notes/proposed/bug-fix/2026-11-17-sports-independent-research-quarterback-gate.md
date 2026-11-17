# Agent Note: Sports ticket risk-aware selection and autonomous source discovery

Status: proposed

## Problem

The November 16, 2026 ticket selected Philadelphia, Houston, Golden State, Baltimore and Denver; only Philadelphia won. This is a five-event observation rather than a calibrated failure-rate estimate. The scorer historically ranked wins and point margins while recording reported injuries and key-player availability mostly as text. A successfully quoted selection could then appear as a final research ticket even with severe unresolved player or schedule risk. A late-breaking absence, an NFL quarterback change or back-to-back can invalidate an early favorite.

## Proposal

Keep verified ESPN fixture identifiers and real matched odds while comparing a wider pool across supported leagues. The preselection specialist now exposes NBA/WNBA rest hours and injury records matched by current athlete IDs to each roster. A timestamp-aware, pure scorer discounts current reported absences against the opponent and the selected team's back-to-back, downranks unconfirmed NFL quarterbacks and NHL goalies, and never turns an unavailable feed into evidence of good health. A sufficiently severe combined screen also marks the final quoted leg as `hold` and requires replacement review. A model prompt instructs Kira to seek additional lawful, independent sources instead of treating user-supplied links or ESPN as a closed catalog.

## Alternatives considered

**Select by lowest market price:** would overvalue short-priced favorites and mistake no-vig market share for an independent calibrated estimate. **Hard-exclude all missing injury reports:** would turn every provider outage into a zero-ticket result and falsely imply that missing data predicts a loss. **Hard-code player names:** would grow stale and fail for traded or newly important athletes. The adopted screen uses actual roster joins and issue-level timestamps; unknown risk is documented, not fabricated.

## Acceptance criteria

- A selected NBA team with several current, roster-reconciled reported outs and materially worse rest is downranked versus less-compromised candidates.
- A stale, future-dated, unmatched or undated injury record never enters the numerical risk score.
- NFL unconfirmed QB remains `hold`; NHL unconfirmed goalie is flagged for a targeted recheck.
- A severe risk finding cannot become a final reviewable ticket solely because matching bookmaker quotes were found; selected prices and source diagnostics remain visible.
- Regression tests cover the old five-favorite failure mode, current-versus-stale injury observations, bilateral risk and final ticket status.
- CI and a point-in-time historical replay using only news available before each kickoff must be reviewed before production claims.

## Risks

Heuristic priority penalties are **not** empirically calibrated win probabilities or expected value. A reported `Out` is not a certified official inactive list, and unknown star impact is never guessed from a name. A lack of roster IDs prevents injury scoring rather than proving an athlete is active. A custom deployment budget may still limit preflight depth and require follow-up on unresolved cases. These changes improve prioritization and safety labeling but do not guarantee a winning five-to-six-leg parlay.

## Verification

Added unit regressions in `ticket-preselection-risk.test.mjs` and `sports-ticket-decision.test.mjs`. Existing workflow checks must be inspected per changed file, since unrelated repository-wide lint, translation and documentation failures may coexist. No actual wager is submitted by these workflows.
