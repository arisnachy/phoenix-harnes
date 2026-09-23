# Agent Note: Safe Computer learning

Status: implemented

English | [中文](2026-09-23-safe-computer-learning.zh.md)

## Problem

Computer results report that the operating system accepted an action. That signal does not prove that the user's application goal succeeded, and raw Computer arguments can contain credentials or private form data.

## Decision

The session-learning plugin projects Computer calls immediately into a closed list of browser action names and canonical HTTPS origins. It retains no raw arguments, results, text, coordinates, paths, screenshots, or field values. A trace is discarded on failure, clear, false pass, invalid input, or unfinished tool calls. Only a `goal/change` completion carrying a complete goal promotes the bounded trace to cognitive memory. Repeated verified goals in one project may create an enumerated preference.

`computer_learning` exposes only safe review fields and an explicit exact-id forget operation. Forgetting writes the cognitive tombstone, so audit history remains available while the row disappears from active recall. The projected flow is evidence and never changes permissions, approvals, or tool authority.

## Alternatives considered

**Learn every Computer action when the operating system accepts it.** Rejected because acceptance does not verify the user's goal and can retain private form values.

**Store full Computer arguments and results for later replay.** Rejected because those records can contain credentials, personal data, or transient page state.

**Promote a flow after a model says it succeeded.** Rejected because the model's text is not durable evidence; promotion requires the matching persisted goal completion event.

## Consequences

Computer learning can survive restart through the existing cognitive ledger without creating a second trace store. The generic procedural observer ignores Computer calls so raw desktop actions cannot enter a second learning path. Candidate and malformed Computer records are excluded from automatic search. The feature depends on the goal service's durable completion event; an accepted tool result alone does not create active memory.
