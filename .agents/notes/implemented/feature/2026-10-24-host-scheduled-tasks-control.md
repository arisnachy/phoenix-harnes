# Agent Note: Host authority for scheduled task center writes

Status: implemented

English | [中文](2026-10-24-host-scheduled-tasks-control.zh.md)

## Problem

The Phoenix global task-center UI could list persistent proactive work, but the Host `/phoenix-tasks` channel exposed only read/attention operations. A successful browser submission therefore could never create or manage a durable task.

## Decision

Extend the existing loopback RPC endpoint rather than adding a browser scheduler or a second task ledger. Only a strict, explicit user-created chat schedule may be submitted: canonical future UTC time, nonempty bounded title and instruction, one-shot or five-minute-plus interval recurrence, `createdBy=user`, `senderIdentity=user`, `catchUp=latest`, and `delivery=chat`. Unknown keys and privileged claims are rejected. The Host targets the only active root conversation; absent or ambiguous ownership fails instead of selecting the wrong workspace. `ProactivityEngine.create` durably saves the record before reporting success. Browser pause/resume/cancel calls only act on currently visible task IDs, are applied in the Host engine, and are confirmed against the authoritative list.

## Alternatives considered

**Store tasks in browser localStorage and use timers.** Rejected: it loses autonomy across browser close or Windows restart.

**Guess a workspace when multiple root conversations exist.** Rejected: it would permit silent cross-workspace task execution.

**Allow raw model/system task definitions over UI RPC.** Rejected: it would elevate a browser form into coordinator authority.

## Consequences

A user can now create and control persistent scheduled chat work when exactly one root session is active. Existing Host polling and resumable target-session semantics apply. A global creation with zero or multiple roots returns a user-visible error until an explicit session picker exists; cold execution still requires the Host runtime to be launched. Rich conditional tasks and privileged system tasks continue to use existing scoped tools, not this UI.

UI task history is projected from the Host's existing bounded execution receipts, not inferred from prompts. The UI localizes task status, renders result summaries as text, and does not disclose the original private instruction.

## Testing

Pure input validation and persistent Host RPC write paths, pause/resume/cancel behavior, ownership ambiguities, malformed payload rejection, and frontend confirmed-state actions have focused regression tests. Full static/coverage/Windows suites remain mandatory before promotion.
