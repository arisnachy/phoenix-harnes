# @phoenix-ai/dsh-cognitive-runtime

English | [中文](README.zh.md)

`@phoenix-ai/dsh-cognitive-runtime` derives a bounded, process-local cognitive projection for each live session. The raw session event log remains authoritative, and [`@phoenix-ai/dsh-session-learning`](../session-learning/README.md) remains the owner of cognitive records; this package consumes that ledger rather than creating a second memory authority. Its design extends the existing [cognitive memory layers decision](../../../.agents/notes/implemented/architecture/2026-09-01-cognitive-memory-layers.md).

## Composition

```yaml
- id: cognitive-runtime
  name: '@phoenix-ai/dsh-cognitive-runtime'
  config:
    maxCandidates: 64
    activeLimit: 8
    backgroundLimit: 16
    weights:
      importance: 1
      confidence: 1
      recency: 1
      urgency: 1
      goalRelevance: 1
      novelty: 1
```

The service requires `sessions` and `learningMemory`, exposes `ctx.cognitiveRuntime`, reconstructs existing live sessions during startup, and refreshes after durable session events. It ignores `assistant/chunk` and events marked `ignorable` so streaming output does not churn the projection. Disposal removes the process-local state for that session.

## Cognitive projection

Each snapshot contains the exact `SessionId`, the highest represented event sequence, the candidate count, optional project provenance, and four working-memory partitions: `focus`, `active`, `background`, and `suppressed`. Attention scores combine the ledger's importance, confidence, persisted timestamp recency, pending/error urgency, mission or prospective-work relevance, and inverse observation frequency. Ties use event sequence and code-point ordering, so equal inputs produce the same ranking.

`maxCandidates` accepts 1–128 records and defaults to 64. `activeLimit` and `backgroundLimit` accept 0–128 records and default to 8 and 16. Each attention weight is finite and non-negative; the base composition sets every weight to 1. `suppressed` means that a candidate fell outside the configured memory budgets; it is not a safety inhibition, permission denial, or policy decision.

This projection does not claim consciousness, sentience, human equivalence, or human-like subjective experience. It supplies an inspectable state model for later consumers while leaving goals, permissions, approvals, credentials, tools, prompts, and agent-loop control to their existing owners.

## Failure and persistence behavior

The service is read-only over the canonical log and cognitive ledger. Its snapshots are process-local and are rebuilt from persisted records after restart; the snapshot itself is not a second durable store. A refresh that fails retains the last successful state and logs the failure. A live session with no records gets an empty snapshot with `observedSeq: -1`; a missing or disposed session returns no state.

All ranking inputs come from persisted records. The service does not use wall-clock reads, randomness, an LLM, or a new durable event type, so replaying the same ledger produces the same projection.

## Model Experience

### Process-local cognitive state

#### What the model sees

No model sees this package directly. It contributes no prompt text, model request field, tool schema, permission, approval, or goal mutation. A future consumer may read `ctx.cognitiveRuntime.get(sessionId)` as untrusted process-local evidence, but this package does not decide whether that evidence is shown to a model or used to authorize an action.

#### Token effect

None; the runtime does not append state to a model request.

#### KV Cache effect

None; the runtime does not assemble or send provider requests.

## Known Limitations and Deferred Work

- The projection ranks records already produced by `session-learning`; it does not infer new semantic memories, learn skills, run experiments, or replace the canonical event log.
- Attention is deterministic and ledger-based, not embedding-based or human cognition. Future consumers may add richer signals without moving ownership of durable memory or permissions into this package.
- State is not persisted independently and is not yet a model-context or browser-panel consumer. Those surfaces require their own explicit contracts, session events, and safety review.
