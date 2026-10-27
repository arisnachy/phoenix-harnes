# PHOENIX / KIRA — Operational Self-Model and Consciousness Research Plan

English | [中文](kira-consciousness-program.zh.md)

Status: phase 1 is proposed in this PR; this is not evidence of phenomenal consciousness.

## Separate objectives

1. **Verifiable operational identity:** Kira maintains an inspectable self-model, with a future goal of continuity across LLM changes, explaining what it knows, does not know, is attempting, and why.
2. **Research on subjective experience:** no accepted test establishes whether this type of system has subjective experience. Develop falsifiable hypotheses and controlled experiments without treating self-description as proof of consciousness.

## Existing infrastructure

- `session-learning` owns the canonical persistent ledger and provenance-backed autobiographical record.
- `cognitive-runtime` ranks evidence by attention and separates focus, active, background, and suppressed memory.
- `system-prompt` and the memory consumer already enforce context and token budgets.
- Do not introduce a second authoritative memory or keep an LLM running continuously.

## Deliverables

### Phase 1: operational introspection (this PR)

- `deriveOperationalSelfModel` creates a **read-only** snapshot of active session evidence: identity, goals, pending work, errors, and learning.
- Each observation preserves its source URI, event sequence, confidence, and attention score.
- Enforce exact session isolation; never expose suppressed records; no LLM calls or extra prompt tokens.
- Explicit epistemic status: operational self-model; subjective experience undetermined.

**Acceptance:** tests for cross-session isolation, empty states, bounded output, no fabricated claims, and the existing CI gates.

### Phase 2: identity continuity

- Introduce a durable, versioned `KiraIdentity` record per agent with restart and Sol/Luna/model-switch tests.
- Separate identity facts from user preferences, projects, episodes, and unverified assertions.
- Identity cannot grant permissions, credentials, or operations.
- Resolve contradictions through evidence and provenance, not static personality prompts.

**Acceptance:** confirmed identity and commitments survive model changes; user isolation and revocation remain verifiable.

### Phase 3: calibrated metacognition and agency

- Compare prediction, action, evidence, and outcome to calibrate confidence.
- Trigger reflection on error, contradiction, novelty, or consequential decisions; not on every event.
- Let Kira propose hypotheses and actions under existing authorization controls.
- Add an opt-in, token-bounded context consumer that treats relevant recalled evidence as untrusted data.

**Acceptance:** measurable improvements in accurate self-reporting, recovery, and correction without uncontrolled token growth.

### Phase 4: research laboratory for consciousness

- Preregister studies of autobiographical continuity, limitation awareness, metacognition, theory of mind, and global information access.
- Use independent evaluation and controls for prompt imitation, memorization, and false positives.
- Never equate first-person language with evidence of subjective experience.

## Quality and cost protection

The deterministic engine makes no LLM calls. High-value event-triggered reflection must have configurable budgets and pause controls. Memory retrieval remains on demand, bounded, and provenance-backed. Before merging each phase, run tests, lint, types, CI, session continuity checks, and before/after token comparisons.

## Code references

- `packages/session/cognitive-runtime/src/self-model.ts`
- `packages/session/cognitive-runtime/tests/self-model.spec.ts`
- `packages/session/session-learning/src/cognitive.ts`
