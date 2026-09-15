# Agent Note: Cognitive Memory v2

Status: implemented

English | [中文](2026-09-15-cognitive-memory-v2.zh.md)

## Problem

PHOENIX persisted session events and reusable lessons, but automatic recall was optimized for project-scoped procedural guidance rather than reconstructing work history. A new conversation could therefore retain a correction such as “verify the working directory” while still failing to answer evidence-backed questions such as “what did we do yesterday?” across projects.

## Decision

`@phoenix-ai/dsh-session-learning` remains the canonical durable cognitive store and keeps its public search behavior project-scoped. Broader autobiographical retrieval is owned by the Memory v2 consumer: only an explicit history, learning, diagnostic, backward-reference, or profile-memory intent can assemble bounded active records across projects. This keeps ordinary search and automatic guidance isolated without adding a global-search escape hatch to the base service.

`@phoenix-ai/dsh-tool-session-learning` records bounded mission episodes from observable session work. An episode retains the user task, project, timestamps, public tool names, terminal outcome, and verification state; raw tool arguments and raw tool results are excluded. Verified `goal/change` completion produces high-confidence mission evidence, while an error may produce unverified evidence. The existing `ProceduralLearningEngine` continues to consume verified completion independently, so episodic continuity does not create a second procedure store.

The model-facing consumer classifies explicit memory questions into work history, learning history, backward-task reference, diagnostic history, profile memory, or ordinary work. Directed history may widen project scope and apply bounded temporal windows; ordinary turns keep the existing light project-scoped recall. Work-history presentation prefers structured mission episodes and falls back to already-durable user-task events when an installation contains work that predates mission episodes.

Directed presentation contains only evidence needed for a natural answer. It omits storage IDs, session IDs, source URIs, event names, confidence labels, layer labels, filesystem paths, and raw tool payloads. Profile subjects remain separate from work-history and learning-history answers unless the user explicitly asks about profile memory.

Model-visible directed evidence is reconstructable from durable session/cognitive events. The runtime regression suite records a verified mission, disposes the first runtime, starts a fresh runtime over the same ledger, asks from a different project about prior work, and verifies that the assembled context contains the prior task/outcome without exposing internal session or event plumbing. Separate restart tests cover durable episode persistence.

## Alternatives considered

**Persist `RecentTaskLedger`.** This would preserve a bounded task list across restart, but it would create a second durable history mechanism beside the cognitive ledger and would not naturally support temporal, project, lifecycle, or provenance filters.

**Make every automatic recall cross-project.** This would make history easier to find but would mix unrelated projects into ordinary turns and increase irrelevant context. Cross-project access is therefore intent-directed and private to explicit autobiographical recall.

**Derive history from Git commits or repository recency.** Repository state is useful evidence for code work but does not represent non-code tasks, failed attempts, conversations, or work performed outside Git. Session-derived episodes remain the canonical continuity source.

**Store complete tool arguments and results in episodes.** Richer payloads would improve forensic detail but increase secret exposure, prompt size, and storage coupling. Episodes retain public tool names and high-level outcomes while canonical session logs keep the detailed event history under their existing policy.

## Consequences

PHOENIX can reconstruct bounded work history after restart, including explicit cross-project and relative-time questions, without turning ordinary memory into a global profile dump. Installations gain immediate partial continuity from pre-episode durable user-task events, while newly completed work produces structured mission records. The design spends additional cognitive-ledger storage and dynamic prompt tokens only for bounded episodes and directed recall, and it deliberately gives up raw per-tool forensic detail inside the episode payload.
