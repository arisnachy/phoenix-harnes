# PHOENIX Cognitive Runtime Foundation

English | [中文](2026-09-12-cognitive-runtime-foundation-design.zh.md)

## Status

Approved foundation slice for the human-inspired cognitive runtime. This document describes a deterministic projection, not consciousness and not an autonomous authority.

## Goal

Expose a replayable cognitive state for each live session by deriving attention, working memory, and a global workspace from the existing provenance-aware cognitive memory ledger.

The slice must make PHOENIX able to inspect its current focus and bounded context without creating a second session log, changing permissions, or letting a model self-report completion.

## Scope

The change creates `@phoenix-ai/dsh-cognitive-runtime` at `packages/session/cognitive-runtime` and mounts its read-only service in the base bundle after `session-learning`.

The service observes existing session lifecycle and durable session events. It refreshes only for cognitive-relevant events and reads bounded, project-scoped records from `ctx.learningMemory`. Its public snapshot is deterministic for the same session log and configuration.

The first slice includes:

- `CognitiveState` with session identity, project identity, observed sequence, candidate count, focus, active items, background items, and budget-suppressed items.
- `Attention` as a pure scorer using validated configuration weights for importance, confidence, recency, urgency, goal relevance, and novelty.
- `WorkingMemory` as a pure bounded partition with one focus item, an active list, a background list, and a suppressed list.
- `GlobalWorkspace` as the immutable snapshot assembled from the selected candidates.
- `CognitiveRuntimeService` as the Cordis owner of per-session snapshots and refresh lifecycle.
- Package invariants, focused unit tests, base-bundle composition coverage, and package documentation.

The first slice explicitly excludes model prompt injection, tools, UI, RPC, new durable event types, causal learning, mental simulation, plasticity, scheduler wakeups, and changes to auth, credentials, approval, permissions, or `agent-loop`.

## Existing authorities

The session event log remains the canonical source of durable facts. `session-learning` remains the owner of cognitive memory records and provenance. `goal`, `plan`, `interaction`, `guard`, `jobs`, and `schedule` remain their own authorities; this package only consumes their already-recorded observations.

No new `SessionEventMap` member is needed. A restart reconstructs the same snapshot by replaying the existing session log and rebuilding `session-learning` records. The snapshot is a projection and never replaces canonical events.

## Data flow

```text
session/created or relevant session/event
    -> CognitiveRuntimeService refresh queue
    -> learningMemory.ready()
    -> bounded session/project cognitive records
    -> Attention.score()
    -> WorkingMemory.partition()
    -> GlobalWorkspace.snapshot()
    -> ctx.cognitiveRuntime.get(sessionId)
```

The service ignores streaming `assistant/chunk` events and other events that cannot change the first slice's bounded cognitive view. Refreshes are serialized per service lifecycle, and a failed refresh is contained and logged without breaking the session event publisher.

## State and scoring

All output fields are detached immutable data. The service never uses `Date.now()`, random identifiers, process order, or external state to rank candidates. Recency is normalized against the observed records' persisted `occurredAt` values. Ties resolve by `eventSeq`, then source URI, then record id.

The attention signals are derived only from persisted record fields:

- `importance` uses the record importance.
- `confidence` uses the record confidence.
- `recency` uses the persisted occurrence range.
- `urgency` is high for pending and error records and low otherwise.
- `goalRelevance` is high for mission, pending, or prospective records.
- `novelty` decreases as the persisted frequency increases.

The configured weighted sum is normalized by the sum of configured weights. Configuration validates positive bounded list sizes, finite non-negative weights, and a positive total weight. Fixed maximums protect memory and prompt consumers from unbounded records; deployment defaults remain configurable through Cordis configuration.

`WorkingMemory.partition()` selects the highest-scoring candidate as focus, then fills active and background budgets. Candidates outside those budgets are labeled budget-suppressed; this is not a permission or safety inhibition decision. Forgotten, superseded, and obsolete records are excluded from the active candidate set.

## Service contract

`ctx.cognitiveRuntime` exposes:

- `get(sessionId)` for a detached snapshot, or `undefined` when the session has not been observed.
- `refresh(sessionId)` for an explicit bounded refresh after the caller has changed session state.
- `ready()` as the lifecycle barrier for queued refreshes.
- `config` as the resolved read-only scoring and budget configuration.

The service is not a remote Typert authority in this slice. It has no write methods, no action execution, and no permission effect. Future model-visible consumers must render the snapshot as untrusted context and record any admitted context through the existing agent/session mechanisms before being mounted in a profile.

## Failure handling

Invalid configuration fails during service construction. Missing session ids return `undefined`. Learning-memory load or refresh failures are logged and leave the last successful snapshot intact. A listener never throws back through `session/event`; the queue records the failure and remains usable for later events.

## Testing

The package tests cover deterministic scoring, tie-breaking, urgency and goal relevance, bounded partitions, suppression semantics, invalid configuration, refresh/reload reconstruction, duplicate event delivery, and failure retention. The base bundle test proves the package is declared and mounted after `session-learning`.

The first slice has no model-visible output, so it does not add a transcript snapshot. A later context consumer will require a Loader-backed keyless snapshot before it can be enabled for profiles.

## Deferred phases

The next independent phases are an opt-in model context consumer, self/world models, prediction error, executive control, inhibition integration with existing approval, consolidation, and an observer UI. Each phase must declare its durable state, replay contract, authority owner, and evidence tier before implementation.
