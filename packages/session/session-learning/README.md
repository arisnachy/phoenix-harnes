# @phoenix-ai/dsh-session-learning

English | [中文](README.zh.md)

Persistent, provenance-aware cognitive memory for PHOENIX. The service observes every durable session event, retains the raw session log as the canonical autobiographical archive, and maintains a redacted cognitive JSONL index with working, episodic, semantic, procedural, prospective, associative, and temporal layers.

## Composition

```yaml
- id: session-learning
  name: '@phoenix-ai/dsh-session-learning'
  config:
    path: /absolute/path/to/learning-memory.jsonl
```

The path is explicit because memory records contain user-provided text. The service requires `sessions`, exposes `ctx.learningMemory`, and writes a sibling `<path>.cognitive.jsonl` ledger. Cognitive records are deduplicated by source event, consolidated by subject, and ranked through lexical, entity, relation, project, temporal, importance, confidence, and frequency signals. `forget()` appends an auditable tombstone; no automatic limit removes canonical records.

## Safety and model experience

The ledger does not silently change permissions, credentials, or trusted plugins. Explicit retention signals such as “this is important”, “remember this”, “always”, and “I prefer” are promoted automatically to high-confidence semantic memory; ordinary events remain lower-confidence autobiographical and episodic history. Contradictory semantic values keep their old record and validity interval while the new record points to the superseded value. Summaries and content are bounded and redact bearer tokens, common credential assignments, URLs, and email addresses before persistence. Cognitive search is current-project scoped by default; directed autobiographical consumers must opt into `includeCrossProject` explicitly, so broad history questions do not weaken ordinary project isolation.

## Model Experience

### Durable observation source

#### What the model sees

The service itself adds no prompt or tool schema. A separately composed memory consumer can call `searchCognitive()`, `recallCognitive()`, `timeline()`, `cognitiveForSession()`, and `workingMemory()`. `searchCognitive()` and `recallCognitive()` inherit the current project unless the caller explicitly requests cross-project retrieval. `cognitiveForSession()` is a read-only projection of active records for exactly one `SessionId`; it returns at most 128 newest records in persisted chronological order without changing the canonical session log or cognitive ledger. Consumers remain responsible for selecting bounded records and presenting them as untrusted evidence rather than instructions.

#### Token effect

The observer adds no tokens. A composed memory consumer spends only the bounded records it selects.

#### KV Cache effect

The ledger does not change model requests. An explicit memory read is appended to the next request and therefore begins a new dynamic context suffix.

## Known Limitations and Deferred Work

- Candidate-lesson judging, skill synthesis, experiments, and a browser memory panel remain separate consumers for later phases.
- The hybrid ranker is deterministic and does not claim embedding-level semantic equivalence; a future vector provider can enrich the index without replacing the canonical ledger or tool name.
