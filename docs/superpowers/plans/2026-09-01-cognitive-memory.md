# Cognitive memory layers

English | [中文](2026-09-01-cognitive-memory.zh.md)

> **For the implementation agent:** follow this plan task by task and keep the acceptance evidence with the change.

**Goal:** make PHOENIX memory event-sourced, provenance-aware, project-scoped, and recoverable without treating summaries as canonical data.

**Design:** keep the existing learning API for compatibility and add a separate cognitive JSONL ledger beside it. The cognitive ledger stores immutable event projections and append-only lifecycle rows. Derived layers, search scores, working context, and summaries are rebuilt from those rows. Explicit forgetting writes a tombstone; no automatic retention limit marks canonical records forgotten.

## Tasks

- Extend the ledger with autobiographical, working, episodic, semantic, procedural, prospective, associative, and temporal records, provenance, entities, relations, timestamps, lifecycle history, deduplication, reinforcement, and contradiction supersession.
- Observe every durable session event, not only user messages and tool outcomes, while retaining the existing bounded learning records.
- Add deterministic hybrid retrieval with lexical, entity, relation, project, temporal, importance, confidence, and frequency signals, plus timeline and working-context queries.
- Consolidate durable user facts and preferences without erasing replaced values; retain the old value and its validity interval.
- Render cognitive records in the memory tool and automatic context with safe prompt-delimiter handling so untrusted memory cannot become a variable template.
- Add tests for reload, old records, paraphrase-friendly normalization, contradictions, explicit forgetting, project isolation, temporal queries, duplicate delivery, and prompt safety.
- Update package documentation and an implemented Agent Note, then run focused tests, typecheck, build, and the relevant documentation gates.

**Completion rule:** report implementation, tests, and verification separately. The memory feature is not a substitute for the raw session log; the raw session log remains the canonical conversation archive.
