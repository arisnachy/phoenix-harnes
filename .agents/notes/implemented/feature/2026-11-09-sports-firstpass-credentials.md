# 2026-11-09 · First-pass candidate competition and credential-safe provider coverage

## Diagnosis
evidenceTicket formerly stopped expanding league research when the first count of strong descriptive picks appeared (after two batches), although a stronger candidate could be in a later league. Sports diversity discarded the fifth valid candidate when all picks were from one sport. Checklist completeness was not reflected in the provisional number of legs.

## Changes
- Search at least three league-research batches, and stop early only when at least max(12,3 × requested legs) strong observations have been considered across available sports, bounded by the existing time limit.
- Admit lower-ranked conditional hypotheses only from verified ESPN future fixtures with adequate distinct finished games on both sides. Such hypotheses never become a completed specialist dossier or approved wager.
- Preserve a five/six candidate slate even when only one sport is available. Report the lack of multisport breadth, not an invented game or omitted valid leg.
- Attach an *individual* exploratory recent-form win estimate when the historical model supports it. When two-sided current quotes from the same bookmaker exist, expose the separate no-vig market-implied estimate and its source. Neither is a calibrated win guarantee nor EV.
- Add a complete per-sport research provider matrix: integrated versus planned routes are explicitly distinct. Document coverage holes and missing optional keys without blocking an ESPN/NHL/MLB-backed candidate.
- Query credentials configuration via the host credential service and ambient server environment. Secret values never enter cards, model arguments, logs, tool output, repository or local cache. A user choosing to add a key uses the human-intercepted `/secret set REF VALUE` command, whose input the host does not record in the model session. This is not a newly built Secure Ask API-key form.

## Scientific / operational limits
A user preference for five or six legs cannot create 5–6 future authenticated games on an empty schedule. Keep the candidate draft incomplete when no such games exist. Conditional picks are not guaranteed successes. A model's extrapolation or bookmaker no-vig share is explicitly labeled as such. Do not imply a chosen favorite offers positive value without holdout calibration and a priced market comparison.

## Testing
Core six-sport evidence tests, sports diversity tests, per-leg chance assertions, source matrix tests and full host TypeScript validation under Linux and Windows. All external credentials must be entered by the person into the protected Host workflow, not supplied to Kira in ordinary messages.