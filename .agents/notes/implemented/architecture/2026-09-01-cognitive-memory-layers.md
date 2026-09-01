# Agent Note: Preserve canonical events across cognitive memory layers

Status: implemented

English | [中文](2026-09-01-cognitive-memory-layers.zh.md)

## Problem

Learning memory previously retained only selected user, tool, turn, and error observations in one bounded ledger. Its retention limit could mark older records forgotten, automatic recall was not project-scoped, and untrusted memory text could contain prompt-variable delimiters.

## Decision

`dsh-session-learning` keeps the session event log as the canonical autobiographical archive and writes a sibling `.cognitive.jsonl` append-only index. Every durable session event receives a redacted record with working, episodic, temporal, and event-derived semantic, procedural, prospective, or associative layers. Records retain source session, event sequence, event type, project, source URI, entities, relations, validity interval, confidence, importance, frequency, and lifecycle state.

Semantic records consolidate identical observations through reinforcement and preserve changed values through `superseded` records with validity intervals. Explicit forgetting writes a tombstone; neither the legacy compatibility limit nor cognitive search compacts or removes canonical records. Cognitive retrieval combines normalized lexical tokens, deterministic aliases, entities, relations, project and time filters, importance, confidence, frequency, and recency. Automatic context uses the current project and neutralizes `{{` and `}}` inside untrusted memory values before prompt assembly.

## Consequences

Restarting the learning service reloads both ledgers and reconstructs derived indexes from durable rows. A new model or context summary cannot erase the source event. Superseded facts remain available to timeline and history queries, while explicit forgotten records remain auditable through `allCognitiveRecords()` and are excluded from model retrieval. The ranker is deterministic; it does not claim embedding-level semantic equivalence.

## Alternatives considered

**Replacing the canonical session log with the cognitive index** was rejected because derived indexes can be rebuilt and must not become the only copy of an event. **Compacting old memories into summaries** was rejected because it loses provenance and historical contradictions. **Using embeddings as the only retrieval mechanism** was rejected because deterministic project, time, entity, relationship, and lexical filters are required for auditable recall and predictable isolation.

## Verification

Focused cognitive, legacy-ledger, service, and presentation tests pass together. Workspace `typecheck` also passes, including host build and contract-ready client typecheck. The raw session persistence and live multi-model memory behavior remain governed by their existing runtime and e2e gates.
