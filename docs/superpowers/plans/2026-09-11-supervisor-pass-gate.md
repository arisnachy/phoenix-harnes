# Supervisor PASS Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PHOENIX mission completion supervisor-owned: an autonomous goal round cannot silently finish without independent review, and no time/round boundary may become mission completion.

**Architecture:** Keep `goal-round-driver` responsible only for durable continuation and recovery. Put automatic completion review in `tool-goal`, which already owns the independent adversarial gate and judge. Extend the agent turn-stopping event with the concrete step-end reason so the supervisor reviews only genuinely completed rounds, never max-token attempts. Completion remains fail-closed through the goal domain's existing executable-gate + judge requirements.

**Tech Stack:** TypeScript, Cordis events, Vitest, PHOENIX goal/session/agent services.

**Spec:** User requirement in the 2026-09-11 PHOENIX supervisor conversation: missions end only on supervisor-verified quality, never because of elapsed time, step/round limits, or executor self-report.

## Global Constraints

- No mission-level timeout.
- No maximum-round count may terminate a mission; round windows may rotate only.
- Executor prose or `completed` turn status is not mission completion.
- `DONE` requires independent adversarial completion gate + independent judge PASS for the exact goal revision.
- Recoverable judge failures keep the goal active and feed the next continuation round.
- Explicit deployment compatibility: automatic review follows `requireJudge`; the base/default remains enabled.

---

### Task 1: Expose the stopping reason to supervisor listeners

**Files:**
- Modify: `packages/core/agent/src/runtime-types.ts`
- Modify: `packages/core/agent-loop/src/agent.ts`
- Test: `packages/core/agent-loop/tests/loop.spec.ts`

**Interfaces:**
- Produces: `agent/turn-stopping` payload field `reason: { kind: 'completed' | 'max-tokens' }`.

- [ ] Write a failing test proving listeners receive `completed` vs `max-tokens`.
- [ ] Run the focused agent-loop test and confirm RED.
- [ ] Add the payload field at the dispatch boundary and type declaration.
- [ ] Re-run the focused test and confirm GREEN.

### Task 2: Automatic supervisor review at every completed autonomous goal round

**Files:**
- Modify: `packages/goal/tool-goal/src/index.ts`
- Test: `packages/goal/tool-goal/tests/tool-goal.spec.ts`

**Interfaces:**
- Consumes: `agent/turn-stopping.reason` from Task 1.
- Produces: automatic `goal/judge` audit on an active goal-sourced round even when the executor never calls `update_goal(... complete)`.

- [ ] Write a failing test where a completed goal round reaches turn-stopping without `complete` and assert an automatic judge audit is produced while the goal remains active on non-PASS.
- [ ] Write a failing test where a previously certified exact revision reaches the same boundary and assert the supervisor completes the goal automatically.
- [ ] Run focused tool-goal tests and confirm RED.
- [ ] Add exact-current-round detection, synthetic supervisor CallId, automatic judge invocation, audit persistence, and `ctx.goals.complete` only on PASS.
- [ ] Re-run focused tests and confirm GREEN.

### Task 3: Preserve mission continuity and document the invariant

**Files:**
- Modify: `packages/goal/tool-goal/README.md`
- Modify: `packages/goal/goal-round-driver/README.md`
- Test: existing goal/tool and driver suites.

**Interfaces:**
- Produces: documented guarantee that round/time/token boundaries are attempt-level only and automatic review is supervisor-owned.

- [ ] Update docs to describe automatic turn-end review and fail-closed PASS.
- [ ] Run goal-round-driver and tool-goal suites.
- [ ] Run typecheck/build gates selected by repository CI.
- [ ] Merge only after all checks are green.
