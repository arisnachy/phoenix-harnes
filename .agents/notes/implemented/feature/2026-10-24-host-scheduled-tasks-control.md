# Agent Note: Host authority for scheduled task center writes

Status: implemented

English | [中文](2026-10-24-host-scheduled-tasks-control.zh.md)

## Problem

The Phoenix global task-center UI could list persistent proactive work, but the Host `/phoenix-tasks` channel exposed only read/attention operations. A successful browser submission therefore could never create or manage a durable task.

## Decision

Extend the existing loopback RPC endpoint rather than adding a browser scheduler or a second task ledger. Only a strict, explicit user-created chat schedule may be submitted: canonical future UTC time, nonempty bounded title and instruction, one-shot or five-minute-plus interval recurrence, `createdBy=user`, `senderIdentity=user`, `catchUp=latest`, and `delivery=chat`. Unknown keys and privileged claims are rejected. The Host can target an explicitly selected active root conversation, or infer ownership only when exactly one root exists; absent, unknown, or ambiguous ownership fails closed. `ProactivityEngine.create` durably saves the record before reporting success. Browser pause/resume/cancel/delete calls only act on currently visible task IDs and are confirmed against the authoritative ledger. Permanent deletion erases the record and execution receipts, but refuses tasks currently running. Resume is accepted only for failed or paused work; a running occurrence cannot be paused and re-admitted as a duplicate.

## Alternatives considered

**Store tasks in browser localStorage and use timers.** Rejected: it loses autonomy across browser close or Windows restart.

**Guess a workspace when multiple root conversations exist.** Rejected: it would permit silent cross-workspace task execution.

**Allow raw model/system task definitions over UI RPC.** Rejected: it would elevate a browser form into coordinator authority.

## Consequences

Users can create and control persistent scheduled chat work in a selected active root conversation; a sole active root is the default. Multiple roots require explicit selection. Missing or invalid roots are rejected. Existing Host polling and resumable target-session semantics apply; cold execution still requires the Host runtime to be launched. Rich conditional tasks and privileged system tasks continue to use existing scoped tools, not this UI.

UI task history is projected from the Host's existing bounded execution receipts, not inferred from prompts. The UI localizes task status, renders result summaries as text, and does not disclose the original private instruction.

## Testing

Pure input validation and persistent Host RPC write paths, pause/resume/cancel/delete behavior, running-delivery concurrency, ownership ambiguities, malformed payload rejection, and frontend confirmed-state actions have focused regression tests. Full static/coverage/Windows suites remain mandatory before promotion.
