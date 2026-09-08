# Agent Note: Latest goal judge controls review authority

Status: implemented

English | [中文](2026-09-07-latest-goal-judge-authority.zh.md)

## Problem

Goal completion accepted any passing judge recorded for the current revision, so a later `needs_changes` or `blocked` review could not revoke an earlier pass. The same-session driver independently selected the latest non-passing review, so a later pass could also replay obsolete repair findings.

## Decision

For the exact `{ goalId, revision }`, completion reads the most recent `goal/judge` event and requires its verdict to be `pass`. The round driver and its prompt invariant read that same exact-revision event and provide feedback only when the latest verdict is non-passing. A later pass therefore suppresses older findings, while a later non-passing review remains authoritative until another review replaces it.

## Verification

Goal service regressions cover `pass` followed by `needs_changes` rejection and `needs_changes` followed by `pass` acceptance. Driver integration and invariant regressions cover suppression of earlier `needs_changes` findings after a later pass. The focused goal and driver Vitest files pass together.

## Alternatives considered

- **Keep a historical pass authoritative:** allows completion after a later review has found required changes.
- **Keep selecting the latest non-passing review:** replays obsolete repair instructions after a later pass.
- **Use a session-wide latest review:** can apply another goal revision's judgment to the current deliverable.

## Consequences

Judge history remains append-only, but only the latest exact-revision review governs completion and repair feedback. Reopening work with a new goal revision naturally ignores reviews from earlier revisions. A passing review does not complete the goal by itself; the existing completion gate and explicit completion call remain required.
