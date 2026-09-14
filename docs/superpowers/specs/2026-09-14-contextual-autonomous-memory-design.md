# Contextual Autonomous Memory Design

## Goal

Make Phoenix decide what is worth learning on its own, resolve references such as “the previous problem” against actual mission/conversation context, and recall only procedures that are relevant to the current task instead of injecting the strongest recent procedures blindly.

## Problem

The current procedural runtime can learn verified experience and explicit user teaching, but automatic recall is project-scoped rather than task-scoped. `context:validated-procedures` injects up to four active procedures ordered by confidence, confirmations, and recency. Learned experience also uses the generic trigger “A sufficiently similar task reaches verified completion.” Consequently, a vague request such as “Tengo otro problema parecido al anterior” can attach to the wrong prior procedure even when a more recent/relevant mission exists.

The current model-facing prompt also emphasizes `memory_teach` for explicit user teaching. Phoenix learns some outcomes autonomously, but it lacks a dedicated policy that evaluates completed work and user interactions to decide whether a preference, correction, procedure, project fact, or failure lesson deserves durable retention.

## Design

### 1. Task fingerprints

Introduce a bounded `TaskFingerprint` describing reusable task identity without storing private chain-of-thought or raw tool arguments. A fingerprint contains normalized fields for intent, domain, entities, resources, and concise outcome/summary terms. Fingerprints are persisted with procedural learning state.

A deterministic similarity function scores current-task context against stored fingerprints. Exact project/domain/entity overlap receives stronger weight than generic lexical overlap. A procedure is eligible for automatic recall only when its score passes a minimum threshold, except for procedures explicitly scoped as universally applicable.

### 2. Context-aware procedural recall

Extend `ProceduralLearningEngine.recommend()` with an optional current-task query. Ranking combines task similarity, confidence, confirmations, and recency. Automatic prompt assembly passes the current user/goal context when available. Procedures below the relevance threshold are omitted rather than injected merely because they are recent or highly confident.

The system prompt must state that ambiguous references are evidence-seeking references, not permission to guess. When Phoenix cannot identify a prior task with sufficient confidence from available context/memory, it should search memory/history before acting and should avoid asserting a specific previous problem without evidence.

### 3. Reference resolver

Add a small resolver over recent durable mission/task memories. It recognizes bounded referential forms such as “the previous one”, “the last problem”, “same as before”, and Spanish equivalents. Resolution prefers the most recent task matching the current domain/project and excludes unrelated tool successes. It returns either a confident match or `undefined`; it never fabricates a referent.

The resolver is exposed to automatic context generation so Phoenix receives a compact `<resolved_task_reference>` block only when confidence is sufficient.

### 4. Autonomous memory curator

Add an `AutonomousMemoryCurator` that observes user messages, verified goal completion, explicit corrections, and selected mission outcomes. It classifies only bounded, observable information into:

- durable preference;
- verified procedure/skill;
- reusable recovery lesson;
- stable project fact;
- correction/supersession;
- discard.

The curator must be conservative. Secrets are rejected. One-off transient state and unsupported guesses are discarded. Procedures derived from experience remain candidate until verified completion; verified outcomes can become active. Explicit user corrections quarantine or supersede contradictory knowledge.

No requirement exists for the user to say “remember this”. Explicit teaching remains supported through `memory_teach`, but autonomous retention becomes the default for sufficiently important, verified, reusable information.

### 5. Learning lifecycle

Keep the existing lifecycle: `candidate → active → quarantined`. Add supersession metadata when a newer teaching/correction replaces a previous procedure. Automatic recall only exposes active, non-superseded, relevant procedures.

### 6. Safety and privacy

Do not store raw tool arguments, credentials, tokens, passwords, cookies, private keys, or hidden reasoning. Fingerprints and memory summaries are bounded and normalized. Sensitive or contradictory information is not treated as authoritative without evidence.

### 7. Integration constraints

Preserve existing HARDNESS fail-closed verification, Living Creation traces, adaptive learning, quality contracts, Proactivity, MCP/OAuth reliability fixes, updater/Windows fixes, and the latest UI ordering changes from both `main` and `stable`.

After implementation and verification, reconcile the complete lineage and leave `main` and `stable` pointing to the same final commit.

## Acceptance tests

1. Given multiple learned procedures for unrelated tasks (for example TV control, Brand Institute web flow, and Phoenix UI), a prompt equivalent to “Tengo otro problema parecido al anterior” resolves to the contextually previous relevant task, not simply the highest-confidence or most recent unrelated tool strategy.
2. If no prior task crosses the relevance threshold, Phoenix does not assert a concrete prior problem.
3. A verified completed task produces reusable procedural memory without the user asking Phoenix to remember it.
4. A durable preference/correction stated naturally is retained or supersedes conflicting knowledge without requiring the phrase “remember this”.
5. Automatic recall excludes candidate, quarantined, superseded, secret-bearing, and low-relevance procedures.
6. Existing session-learning, HARDNESS, Living, and UI regression tests continue to pass or show no new regressions beyond the repository’s established baseline.
7. Final `main` and `stable` SHA values are identical.