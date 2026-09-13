# Phoenix Cognitive Context + Quality Spine Implementation Plan

**Goal:** Close Phoenix's existing cognitive loop so the active cognitive workspace is visible to every model step while preserving the existing evidence-bound goal completion gate.

**Architecture:** Extend the existing `@phoenix-ai/dsh-cognitive-runtime` plugin rather than adding loop-specific conditionals. The runtime projects its bounded focus/active/background state as a durable plugin snapshot at `agent/pre-step`. `session-learning` explicitly excludes that derived snapshot from memory indexing, preventing recursive self-memory. Existing HARDNESS/goal completion infrastructure remains authoritative for DONE: executable checks, Evidence Ledger, artifact fingerprint, clean-room verification, and independent Judge.

**Acceptance criteria:**

1. A non-empty cognitive state produces a bounded model-visible workspace before inference.
2. Focus, active commitments, project continuity, confidence/uncertainty, and completion discipline are represented.
3. Recalled content is labelled untrusted evidence, prompt delimiters are neutralized, and total context is capped at 6,000 characters.
4. Empty cognitive state produces no injection.
5. Cognitive snapshots remain in the durable session log but are excluded from both legacy and cognitive learning ledgers.
6. No new workspace package/dependency is required.
7. Existing goal completion gate remains the only certification path for DONE.
8. CI/static/coverage gates pass before promotion.
9. The verified implementation is promoted to both `main` and `stable` without separate logic forks.

**Files:**

- `packages/session/cognitive-runtime/src/context.ts` — pure bounded renderer.
- `packages/session/cognitive-runtime/src/index.ts` — `agent/pre-step` bridge and snapshot ownership.
- `packages/session/cognitive-runtime/package.json` — publish/export the renderer.
- `packages/session/session-learning/src/index.ts` — derived-context exclusion.
- Focused tests under both packages.

**Verification:** PR CI, combined commit status, focused code inspection, branch tree equality after promotion.
