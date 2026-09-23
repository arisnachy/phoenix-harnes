# Phoenix Cognitive Context + Quality Spine Implementation Plan

**Goal:** Close Phoenix's existing cognitive loop so the active cognitive workspace is visible to every model step while preserving the existing evidence-bound goal completion gate.

**Architecture:** Extend the existing `@phoenix-ai/dsh-cognitive-runtime` plugin rather than adding loop-specific conditionals. The runtime projects its bounded focus/active/background state as a durable plugin snapshot at `agent/pre-step`. The canonical session log and learning ledger remain auditable; cognitive-runtime filters its own derived snapshots before attention/working-memory scoring so the workspace cannot recursively reinforce itself. Existing HARDNESS/goal completion infrastructure remains authoritative for DONE: executable checks, Evidence Ledger, artifact fingerprint, clean-room verification, and independent Judge.

**Acceptance criteria:**

1. A non-empty cognitive state produces a bounded model-visible workspace before inference.
2. Focus, active commitments, project continuity, confidence/uncertainty, and completion discipline are represented.
3. Recalled content is labelled untrusted evidence, prompt delimiters are neutralized, and total context is capped at 6,000 characters.
4. Empty cognitive state produces no injection; transition from a populated workspace emits an explicit clearing snapshot.
5. Cognitive snapshots remain durable/auditable but are excluded from cognitive-runtime attention and working-memory scoring, preventing self-reinforcement.
6. No new workspace package/dependency is required.
7. Existing goal completion gate remains the certification path for DONE.
8. CI/static/coverage gates pass before promotion.
9. The verified implementation is promoted to both `main` and `stable` without separate logic forks.

**Files:**

- `packages/session/cognitive-runtime/src/context.ts` — pure bounded renderer and projection detection.
- `packages/session/cognitive-runtime/src/index.ts` — `agent/pre-step` bridge, durable snapshot projection, and self-feedback filter.
- `packages/session/cognitive-runtime/tests/context.spec.ts` — content, uncertainty, injection-safety, and size bounds.
- `packages/session/cognitive-runtime/tests/feedback.spec.ts` — self-reinforcement regression coverage.

**Verification:** PR CI, combined commit status, focused code inspection, and branch comparison after promotion.
