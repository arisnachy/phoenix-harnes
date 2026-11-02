# Agent Note: Persistent learning ledger

Status: implemented

English | [中文](2026-08-29-session-learning-ledger.zh.md)

## Problem

Phoenix needs to retain useful evidence from interactions, successful work, and failures without treating hidden model state, credentials, or permissions as learning data.

## Decision

The `@phoenix-ai/dsh-session-learning` service observes the durable session event stream and operational `agent/error` events, converts selected outcomes into bounded records, and persists them in an owner-only append-only JSONL ledger under the harness home. Records carry a branded memory id, session id, source sequence, kind, summary, source event type, confidence, and timestamps. Source-event deduplication makes reloads and retries idempotent; forgetting appends a tombstone; search returns only active records with provenance and newest-first ordering. The service is mounted in the base composition, while `@phoenix-ai/dsh-tool-session-learning` exposes bounded `memory_search` and `memory_remember` operations to the model. Explicit memory is restricted to preferences, lessons, and skills from the current session; common credential assignments are redacted before persistence. The tools return evidence and confidence and do not silently modify prompts, permissions, credentials, or trusted plugins.

The ledger is the first persistence layer for the learning supervisor. Explicit retention signals in user messages, such as important, remember, always, and prefer statements, are promoted to high-confidence preference records without requiring a memory tool call; ordinary interactions remain lower-confidence history. Judge-filtered lessons, skill promotion, semantic retrieval, memory management commands, and UI projections remain separate consumers so each can add policy without changing the session loop or the durable conversation format. The shipped learning-tool consumer adds at most eight records through `recall()`: high-confidence durable preferences, lessons, and skills are selected before recent non-interaction evidence; raw interaction records still require explicit search, and no memory grants permissions or is treated as an instruction.

## Alternatives considered

**Store memories only in the session log.** This keeps one file but mixes derived learning with the canonical conversation stream and makes forgetting or re-scoring difficult without rewriting history.

**Use a second database with embeddings immediately.** This provides richer retrieval but adds a new durability and migration surface before Phoenix has a validated learning policy; deterministic bounded search is sufficient for the foundation.

**Write all memories into the system prompt automatically.** This would make raw user data model-visible without a deliberate search and would allow stale or contradictory records to influence work silently. The shipped consumer uses a bounded non-interaction evidence context instead.

## Consequences

The service learns deterministic observations immediately and survives process restarts, but it does not claim human cognition or autonomous self-modification. JSONL append-only storage is inspectable and recoverable, while search is token-based and can later be replaced behind the service API. The initial implementation has focused tests and type/build verification; real user-memory migration, judge feedback, and browser controls still require their own contracts and tests. The priority policy keeps explicit important memories available after noisy later activity without claiming human cognition.
