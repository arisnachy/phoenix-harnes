# Agent Note: Add a bounded cognitive runtime projection

Status: implemented

English | [中文](2026-09-12-cognitive-runtime-foundation.zh.md)

## Problem

PHOENIX already records session events and derives provenance-aware cognitive records, but a consumer still needs a deterministic process-local view of what is most relevant within bounded working-memory regions. That view must not become a second durable memory authority or acquire permission to act.

## Decision

`@phoenix-ai/dsh-cognitive-runtime` consumes the exact-session projection owned by `@phoenix-ai/dsh-session-learning` and derives `CognitiveState` with deterministic attention scores and `focus`, `active`, `background`, and `suppressed` partitions. The raw session event log remains authoritative, and the learning ledger remains the owner of cognitive records; the runtime stores only detached process-local snapshots.

The base bundle mounts one `cognitive-runtime` row after `session-learning` with explicit bounded configuration: at most 64 candidates, an active region of 8 records, a background region of 16 records, and unit weights for importance, confidence, recency, urgency, goal relevance, and novelty. Configuration validation caps each candidate and region budget at 128 and rejects non-finite or negative weights.

The runtime reconstructs all live sessions at startup and refreshes after durable session events. It ignores assistant stream chunks and explicitly ignorable events, serializes refreshes, retains the last successful snapshot after a refresh failure, and removes state when a session is disposed. Ranking uses persisted record timestamps and stable event/source ordering; it does not read the current wall clock, use randomness, call an LLM, or add a durable event type.

`suppressed` is a budget partition, not a safety inhibition. The runtime does not claim consciousness, sentience, human equivalence, or subjective experience, and it does not mutate prompts, tools, permissions, approvals, credentials, goals, or agent-loop control. Later model, UI, or action consumers require their own explicit contracts and safety review.

## Consequences

Consumers can inspect a stable per-session state without reconstructing the ledger themselves, while replay and startup reconstruction remain deterministic. Failure retention prevents a transient read failure from erasing the last known projection. The process-local snapshot can be discarded and rebuilt because the canonical event log and learning ledger remain the durable authorities.

The first slice does not infer new semantic memories, learn skills, run experiments, provide a model-context consumer, or expose a browser panel. Those capabilities remain separate work and must preserve event logging, provenance, and permission ownership.

## Alternatives considered

**Replacing the session log or learning ledger with `CognitiveState`** was rejected because a derived projection must remain rebuildable and must not become the only copy of an event or memory record.

**Letting the runtime mutate goals, permissions, tools, or prompts** was rejected because those authorities already have explicit interaction, approval, and loop contracts; a read-only projection keeps cognitive ranking separate from authorization.

**Using ambient time, randomness, or an LLM for ranking** was rejected because replayable startup and event refresh require identical persisted input to produce identical state before a future consumer applies any model-specific interpretation.

## Verification

The pure attention and working-memory projection has focused tests with 100% statement, branch, function, and line coverage. The service, invariant, and bundle tests cover startup reconstruction, durable-event refresh, ignored events, failure retention, queue recovery, bounded configuration, partition invariants, and base ordering. `verify-cordis-config` validates the repository's Cordis configuration files, and the package is included in the host TypeScript aggregate.
