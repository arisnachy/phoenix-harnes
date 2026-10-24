# Agent Note: Prevent premature Team shutdown while a persistent Goal remains active

Status: implemented

English | [中文](2026-10-15-unfinished-mission-active-goal-and-team-task-fence.zh.md)

## Problem
The Team Lead's `turn/end: completed` is emitted even when Kira provides an interim progress report. The Team runtime previously closed UME on that event, interrupted specialists and published a terminal checkpoint. This disarmed the separate Goal round driver. The first repair checked `todo/write`, but an active Goal or Team task without a checklist still triggered premature shutdown; a later human steering message could also hide an older pending checklist.

## Decision
Read the durable `goal/change` phase, latest checklist and revisioned `team/task` states from the same Lead Session. A model turn cannot terminate the Team mission while any of those surfaces contains active work. Current mission boundaries are based on `team/mission` revision-one receipts rather than replacing work with each steering message. Explicit user cancellation still stops immediately. Fully complete work retains the prior one-time terminal fence; the Goal driver continues to own serialized automatic rounds, bounded strategy changes and quota stops.

## Verification
Pure regression fixtures now cover active Goal without a checklist, closure prose preceded by effect and check receipts, pending and completed Team tasks, steering without losing older checklist items, and explicit human cancellation. Runtime integration, Windows build and model-provider end-to-end must still be performed before claiming the deployed Phoenix instance repaired.

## Existing sessions written by the earlier faulty version
A durable `team/mission: partial` checkpoint created at a normal model `turn/end: completed` could prevent an already-active Goal from waking after upgrade. The Goal fence now admits only that legacy combination (last turn completed and latest Goal snapshot still active). It does **not** reinstate the terminal UME team, revive old children, or bypass explicit cancellation, verified completion or provider-blocked Goals. On Host restart, the normal Goal driver can re-arm and continue solo.

## Consequences

Explicit user cancellation and genuinely completed work remain terminal.

## Alternatives considered

Close the mission on every completed model turn. Rejected because pending Goals and Team tasks would be interrupted.
