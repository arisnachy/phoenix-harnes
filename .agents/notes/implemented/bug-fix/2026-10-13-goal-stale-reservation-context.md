# Agent Note: Wake pending context after a stale goal reservation

Status: implemented

English | [中文](2026-10-13-goal-stale-reservation-context.zh.md)

## Problem

The goal-round driver correctly rejects an automatic prompt when a queued human or plugin message makes its reservation stale. The agent loop removes the claimed proposal and returns to `idle`, but a waking message inserted while the loop was already running does not wake that loop again. The pending non-goal message therefore remains in the inbox indefinitely; the observed symptom was a 30-second test timeout and, with an exhausted scripted adapter, repeated recovery activity.

## Decision

Keep the stale reservation fence and downstream rejection behavior unchanged. After rejecting a stale proposal, the driver records at most one pending non-goal message for that exact agent lifecycle and waits for `agent.whenIdle()`. At idle, it removes that same pending message and re-delivers it through the public `Agent.followup()` wake path. Goal-sourced messages are never selected for this repair wake. When a downstream hook intentionally returns context that it also queued, the driver removes the queued copies before entering the returned batch, so the context is admitted once and cannot trigger another recovery loop.

The repair is process-local scheduling state only. It does not alter goal revisions, round counts, closed-mission blocking, downstream `reject`, cancellation, or the positive-round source fence. A disposed or replaced agent, a changed lifecycle, or a missing pending message cancels the wake safely.

## Alternatives considered

**Return the stale proposal's context directly.** Rejected because work inserted after the claim is not part of that proposal, and downstream rejection must remain authoritative.

**Wake every pending message or retry the goal.** Rejected because it can duplicate context or recreate the hot loop. The driver selects one existing non-goal message and lets the normal inbox claim process batch the rest.

**Change the core agent loop.** Rejected because the defect is the goal driver's stale-reservation recovery policy; the public follow-up API already provides the required waking operation.

## Consequences

- A human or plugin message queued behind a stale automatic goal round receives one normal model turn before the goal driver considers a new round.
- Context returned by a downstream pre-step hook is admitted once even when that hook also queued it.
- Automatic goal authority remains fenced by the exact reservation, goal revision, active/armed state, and universal-mission guard.
- The wake is best-effort during disposal or agent replacement; those lifecycle transitions retain their existing fail-closed behavior.

## Testing

`packages/goal/goal-round-driver/tests/goal-round-driver.spec.ts` covers the stale reservation with a human message queued behind it, restoration after a failed wake delivery, claimed non-goal context restored across a goal edit, and post-hook revision rechecking. The focused run passes all four cases with Vitest and a bounded timeout. The prompt assertion was updated to the current verification-stall wording.
