# Agent Note: Durable execution journal

Status: implemented

English | [中文](2026-10-21-durable-execution-journal.zh.md)

## Problem

Native engines acknowledge requests before their work finishes. A lost response, Host restart, cancelled mission, failed disk flush or changed model must not silently duplicate a task or turn an uncertain operation into success.

## Decision

Reuse the existing Lead Session, Team journal and universal mission ledger. `team/execution` stores versioned whole snapshots; `team/execution-progress` stores bounded metadata with native-event deduplication; `team/execution-context` records selective memory provenance before dispatch. No parallel mission or memory database is introduced.

The execution runtime freezes provider, model, reasoning, capabilities, mission identity and cancellation epoch at reservation. Exact idempotency keys reject changed explicit model selections. A reserved operation may start after its durability barrier is repaired; prepared, dispatched, running and uncertain native work must reconcile the same binding instead of starting a replacement task. A failed execution flush blocks receipt reads until the next serialized transaction successfully flushes the retained events. A missing adapter preserves recoverability.

User abort fences dispatch immediately, and durable cancellation rejects late completion. Mission cancellation only affects operations belonging to the captured mission. Host shutdown aborts owned work and waits within the existing disposal budget; a timeout is an error and leaves the operation tracked, while a late native result remains uncertain. Completing a model turn does not close a mission with unfinished executions.

Lead-only tools dispatch, list bounded receipt summaries, recover and cancel. Capability routing selects one connected compatible engine while preserving the concrete model route. Existing providers continue through the internal adapter. The optional learning service supplies only scoped, bounded procedural reference material, never instructions or copied history. The Eclipse execution-engine preference remains independent of its two model seats and conversation picker.

## Alternatives considered

A separate execution database duplicates mission ownership and introduces competing recovery authorities. Reusing the Session journal keeps the request, native binding, authorization and result in one durable stream. Automatic resubmission after acknowledgement loss can duplicate native effects; recovery instead reconciles the original native identity.

## Consequences

Dispatched external work remains uncertain after a local stop until the native engine proves a terminal result. Uncertain operations retain their bindings and prevent mission closure. Availability may be lower during native outages, while repeated keys cannot silently create a replacement task.

## Verification and limits

Steering reserves a bounded input receipt before contacting the same active native turn. Repeated keys return the stored receipt, including uncertain or interrupted submissions; they never blindly resend. Codex uses `turn/steer` with its expected turn identity and rejects another root or a closed connection. Shutdown waits for pending input receipts within its existing disposal budget. Other adapters reject steering until they implement an equivalent supported operation.

Focused tests exercise concurrent idempotency, model mismatch, abort-before-dispatch, failed persistence repair, progress limits, mission fencing, cold recovery and bounded disposal. Native Codex has separately demonstrated a completed durable turn followed by process restart and resume of the same thread. Protocol fixtures do not certify real OpenClaw compatibility. Assembled Loader, live Gateway, artifact verification, update integration, full regression and release promotion remain separate gates; this note does not claim they passed.

## Token and cache effects

The stable tool schemas add five Lead-only operations. Receipt listing returns at most 32 identities and states; memory defaults to 4096 bytes and progress receipts to 1024 per operation. No billed token savings or quality improvement is claimed without comparative native usage measurements.
