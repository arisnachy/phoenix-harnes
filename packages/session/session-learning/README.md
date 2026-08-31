# @phoenix-ai/dsh-session-learning

English | [中文](README.zh.md)

Persistent, provenance-aware learning memory for PHOENIX. The service observes durable session events and records bounded interaction, success, error, and durable user-preference memories in an owner-only append-only JSONL ledger.

## Composition

```yaml
- id: session-learning
  name: '@phoenix-ai/dsh-session-learning'
  config:
    path: /absolute/path/to/learning-memory.jsonl
```

The path is explicit because learning records may contain user-provided text. The service requires `sessions`, exposes `ctx.learningMemory`, and deduplicates records by session, event sequence, and kind. `search()` returns active records with newest-first ordering; `forget()` appends an auditable tombstone.

## Safety and model experience

The ledger does not silently change permissions, credentials, or trusted plugins. Explicit retention signals such as “this is important”, “remember this”, “always”, and “I prefer” are promoted automatically to high-confidence preference memory; ordinary interactions remain lower-confidence history. The composed learning-tool consumer contributes only a bounded, untrusted context of durable high-confidence records plus recent non-interaction evidence; raw interaction records require explicit `memory_search`. Summaries are bounded and redact common secret assignments before persistence.

## Model Experience

### Durable observation source

#### What the model sees

The service itself adds no prompt or tool schema. A separately composed memory consumer can call `ctx.learningMemory.search()` and must render returned records with their source session, event sequence, and confidence. The shipped learning-tool consumer also calls `recent()` during assembly for a bounded non-interaction context; the read remains untrusted evidence rather than instructions.

#### Token effect

The observer adds no tokens. A future explicit memory consumer spends only the bounded records it selects.

#### KV Cache effect

The ledger does not change model requests. An explicit memory read is appended to the next request and therefore begins a new dynamic context suffix.

## Known Limitations and Deferred Work

- Candidate-lesson judging, skill synthesis, experiments, and a browser memory panel remain separate consumers for later phases.
