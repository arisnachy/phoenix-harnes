# Phoenix Cognitive Learning Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Phoenix learn reusable procedures from verified work and explicit teaching while raising HARDNESS quality standards and reconciling `main`/`stable` without losing capabilities.

**Architecture:** Keep HARDNESS as executive authority, add a focused procedural-learning module beside the current adaptive strategy engine, and feed it bounded session events. Add task-specific quality requirements before the independent judge. Reconcile branch histories only after the merged code tree is verified.

**Tech Stack:** TypeScript, Cordis events/services, Vitest, GitHub Actions, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-14-cognitive-learning-runtime-design.md`

## Global Constraints

- Do not remove or weaken HARDNESS fail-closed completion.
- Do not persist raw tool arguments, credentials, or secrets in automatic learning.
- Candidate/quarantined procedures must not enter normal recall.
- Preserve existing adaptive learning behavior unless a regression test proves the intended change.
- Preserve Living, proactivity, Cordis workspace, MCP, update, and UI capabilities from both long-lived branches.
- `main` and `stable` must end on the same verified commit/tree.

---

### Task 1: Procedural learning core

**Files:**
- Create: `packages/session-learning/tool-session-learning/src/procedural.ts`
- Create: `packages/session-learning/tool-session-learning/tests/procedural.spec.ts`

**Interfaces:**
- Produces `ProceduralLearningEngine`, `ProceduralMemoryStore`, `filterProceduralSearchHits`, `installProceduralLearning`.
- Persists guided and experience procedures in the existing cognitive-memory store.

- [ ] Write tests proving guided rules become active, verified experience becomes active, corrections quarantine procedures, candidates/quarantined rows are filtered, and secrets are rejected.
- [ ] Run targeted Vitest and confirm RED because the module does not exist.
- [ ] Implement minimal procedural engine and event trace.
- [ ] Run targeted Vitest and confirm GREEN.

### Task 2: Guided teaching tool and recall integration

**Files:**
- Modify: `packages/session-learning/tool-session-learning/src/index.ts`
- Modify: `packages/session-learning/tool-session-learning/tests/plugin.spec.ts`

**Interfaces:**
- Consumes `ProceduralLearningEngine`.
- Produces `memory_teach` and combined adaptive/procedural recall filtering.

- [ ] Add failing plugin tests for `memory_teach` registration and system-prompt guidance.
- [ ] Run targeted tests and confirm RED.
- [ ] Register `memory_teach`, install procedural learning, and compose search filters.
- [ ] Run targeted tests and confirm GREEN.

### Task 3: Task-specific quality contracts

**Files:**
- Create: `packages/hardness/adapters/src/quality-contract.ts`
- Create: `packages/hardness/adapters/tests/quality-contract.spec.ts`
- Modify: `packages/hardness/adapters/src/mission-orchestrator.ts`

**Interfaces:**
- Produces `qualityRequirementsForNeed(need)`.
- `missionGoal()` appends the inferred requirements to the existing generic quality requirements.

- [ ] Write failing tests for software, UI, research/document, data, and general requests.
- [ ] Run targeted tests and confirm RED.
- [ ] Implement bounded deterministic profile inference.
- [ ] Wire the requirements into HARDNESS mission goal creation.
- [ ] Run targeted tests and confirm GREEN.

### Task 4: Documentation and regression verification

**Files:**
- Modify: `packages/session-learning/tool-session-learning/README.md`
- Modify: `packages/hardness/adapters/README.md`

- [ ] Document learn-by-doing and guided teaching without claiming model-weight training.
- [ ] Run targeted tests, typecheck/CI gates available in GitHub Actions, and inspect failures.
- [ ] Fix only regressions attributable to this change.

### Task 5: Preserve-union branch reconciliation

**Files:**
- Git history/tree operation; no source file is intentionally discarded.

- [ ] Compute branch-exclusive changes from the common merge base.
- [ ] Build a reconciled tree that preserves all non-conflicting changes and resolves true overlaps in favor of the superset behavior.
- [ ] Create a two-parent reconciliation commit (`main`, `stable`).
- [ ] Run CI on that commit.
- [ ] Integrate the cognitive runtime on top and rerun CI.
- [ ] Point both `main` and `stable` to the same verified final commit.
- [ ] Verify `compare main...stable` reports identical code/history position.
