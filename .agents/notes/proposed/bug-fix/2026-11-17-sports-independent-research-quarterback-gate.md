# Agent Note: Qualitative Kira-led sports ticket selection

Status: proposed

## Problem

The automatic sports-ticket workflow was letting historical form rankings and arbitrary numerical risk penalties preselect winners, then inviting Kira merely to narrate the output. The user instead wants Kira to compare complete rosters and genuine statistics of both teams and independently decide which fixture is defensible. A market price, loss margin, player absence or rest interval should not be assigned fabricated point weights to force the choice.

## Proposal

Use sports tools as evidence collectors and validators, not as the model that decides winners. The automatic ticket is explicitly a provisional quoted study and exposes `modelComparisonBriefs` across investigated alternatives, plus `selectedBilateralDossiers` for the initially displayed legs. NBA/NFL/NHL specialists now preserve both team rosters and player roles, available individual stats, recent games and team statistics in `teamComparison`. A pure qualitative injury review contains source-dated player reports, roster reconciliation provenance and rest in hours without constructing confidence values, penalties, composite scores or arbitrary risk tiers. Kira independently reviews both teams, seeks contradictory evidence and selects or replaces picks via `sports_chat_ticket_research` with the verified event IDs. Bookmaker quotes remain price observations independent of the team's merit.

## Alternatives considered

**Assign numerical weights to every metric.** Rejected: no measured relationship was established between those hand-selected coefficients and future outcomes. **Take the lowest-odds favorites.** Rejected: market price is not an independent reason to believe the team will win. **Accept an automatic shortlist as final and make Kira only explain it.** Rejected: narration does not constitute a fresh, independent selection. **Pretend a model has already reviewed the picks.** Rejected: there must be an actual model step after the evidence is returned.

## Acceptance criteria

- Injury data is deduplicated by athlete and publication time, and each side is independently labeled as roster-reconciled or unverified league report.
- Each investigated NBA, NFL and NHL event can supply bilateral player names, roles, published statistics, recent matches and lineup certainty when those sources actually published them.
- Qualitative review returns no score, priority, weighted penalty, synthetic probability or expected value; numeric stats and commercial prices are retained as source facts.
- The preselection reviewer applies a neutral legacy priority rather than adding scoring weights; it may still reject objectively contradictory fixture identity.
- An automatic quote is presented as a provisional study pending Kira's own comparative reasoning; never mislabel it as a model-approved final ticket.
- Tests confirm both teams' evidence, duplicate status updates, unavailable sources, NFL QB and NHL goalie uncertainties and non-numeric decision flags.
- Targeted CI, build, replay and model/tool interaction are required before claiming production success.

## Risks

The legacy slate collector still uses descriptive historical ordering to decide which events receive expensive research first. It is discovery prioritization and is **not** Kira's final selection, but it can bias which alternatives are available. Large rosters increase response volume, so the comparative packet remains bounded. A model can make wrong judgements despite rich data; no five-or-six-leg parlay can be promised to win. This change does not add a new external search permission or bookmaker account.

## Verification

Added and updated `ticket-preselection-risk.test.mjs` and `sports-ticket-decision.test.mjs`. Inspect the actual CI and Kira's end-to-end final selection before merging to production.
