# Contextual Autonomous Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Phoenix autonomously retain reusable knowledge, resolve vague references to the correct prior task, and automatically recall only task-relevant validated procedures.

**Architecture:** Extend the existing procedural learner instead of replacing it. Add a bounded task-fingerprint/relevance module, a recent-task reference resolver, and an autonomous curator driven by observable session events. Feed the current user task into procedural recommendation and automatic context while preserving the existing candidate/active/quarantined lifecycle and secret filtering.

**Tech Stack:** TypeScript, Cordis session events, Phoenix cognitive memory, Vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-14-contextual-autonomous-memory-design.md`

## Global Constraints

- Do not store raw tool arguments, credentials, tokens, passwords, cookies, private keys, or hidden reasoning.
- Preserve HARDNESS fail-closed verification, Living traces, adaptive learning, quality contracts, Proactivity, MCP/OAuth/updater/Windows fixes, and current UI ordering behavior.
- Candidate, quarantined, superseded, secret-bearing, and low-relevance procedures must not enter automatic recall.
- Final `main` and `stable` must point to the same commit.

---

### Task 1: Task fingerprints and contextual ranking

**Files:**
- Create: `packages/session-learning/tool-session-learning/src/task-context.ts`
- Modify: `packages/session-learning/tool-session-learning/src/procedural.ts`
- Test: `packages/session-learning/tool-session-learning/tests/procedural.spec.ts`

**Interfaces:**
- Produces: `TaskFingerprint`, `fingerprintTask(text)`, `taskSimilarity(query, candidate)`.
- Extends: `ProceduralLearningState` with optional fingerprint and `ProceduralRecommendationQuery` with optional `taskContext`.

- [ ] **Step 1: Write failing tests** covering unrelated TV/Brand Institute/UI procedures and requiring Brand Institute to rank first only when the current task overlaps it; also assert unrelated procedures are omitted below threshold.
- [ ] **Step 2: Run the focused test** with `pnpm vitest packages/session-learning/tool-session-learning/tests/procedural.spec.ts` and confirm the new expectations fail.
- [ ] **Step 3: Implement `task-context.ts`** with bounded normalization/tokenization, stop-word filtering, fingerprint extraction, deterministic weighted overlap, and a conservative relevance threshold.
- [ ] **Step 4: Persist fingerprints** for guided/experience procedures and use similarity as the primary ranking gate before confidence/confirmations/recency.
- [ ] **Step 5: Run focused tests** and require PASS.

### Task 2: Recent-task reference resolver

**Files:**
- Create: `packages/session-learning/tool-session-learning/src/task-reference.ts`
- Modify: `packages/session-learning/tool-session-learning/src/index.ts`
- Test: `packages/session-learning/tool-session-learning/tests/plugin.spec.ts`

**Interfaces:**
- Produces: `RecentTaskLedger`, `resolveTaskReference(message, tasks)` and bounded `<resolved_task_reference>` presentation.
- Consumes user/session events and current project id.

- [ ] **Step 1: Write failing tests** for Spanish/English references (`anterior`, `último problema`, `same as before`) with several recent unrelated tasks.
- [ ] **Step 2: Verify RED** on the plugin/reference tests.
- [ ] **Step 3: Implement a bounded recent-task ledger** populated from user messages and verified goal completion; exclude pure tool-result entries.
- [ ] **Step 4: Resolve only above confidence threshold**; return no concrete referent when ambiguous.
- [ ] **Step 5: Add automatic prompt context** only for a confident resolved reference and verify PASS.

### Task 3: Autonomous memory curator

**Files:**
- Create: `packages/session-learning/tool-session-learning/src/autonomous-curator.ts`
- Modify: `packages/session-learning/tool-session-learning/src/index.ts`
- Modify: `packages/session-learning/tool-session-learning/src/procedural.ts`
- Test: `packages/session-learning/tool-session-learning/tests/plugin.spec.ts`
- Test: `packages/session-learning/tool-session-learning/tests/procedural.spec.ts`

**Interfaces:**
- Produces: `AutonomousMemoryCurator.observeUserMessage(...)`, `.observeVerifiedCompletion(...)`, `.observeCorrection(...)`.
- Uses `ctx.learningMemory.rememberCognitive` for durable preferences/facts/lessons and `ProceduralLearningEngine.recordExperience` for verified reusable procedures.

- [ ] **Step 1: Write failing tests** showing a natural durable preference/correction is retained without `memory_teach`, transient chatter is ignored, and verified work is learned autonomously.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Implement conservative classification** using explicit linguistic evidence plus verified outcome events; no model-generated hidden reasoning and no secret-bearing content.
- [ ] **Step 4: Add supersession/correction behavior** so contradictory prior reusable knowledge is quarantined or replaced.
- [ ] **Step 5: Run focused tests** and require PASS.

### Task 4: Wire current task into automatic recall

**Files:**
- Modify: `packages/session-learning/tool-session-learning/src/index.ts`
- Modify: `packages/session-learning/tool-session-learning/src/procedural-presentation.ts`
- Test: `packages/session-learning/tool-session-learning/tests/plugin.spec.ts`

**Interfaces:**
- Automatic `context:validated-procedures` calls `recommend({ projectId, taskContext, limit: 4 })`.

- [ ] **Step 1: Write failing integration test**: emit a current user task after teaching several procedures and assert only the relevant procedure appears in assembled context.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Track the latest bounded user task** in the plugin and pass it to procedural recommendation and reference resolution.
- [ ] **Step 4: Update prompt guidance**: Phoenix must search/resolve ambiguous references rather than guessing and should autonomously retain durable verified reusable knowledge.
- [ ] **Step 5: Run all session-learning package tests** and require PASS.

### Task 5: Reconcile current main/stable lineage and verify

**Files:**
- Preserve all feature files above plus current UI-order changes from `main`/`stable`.

**Interfaces:**
- Produces one final commit reachable from current `main`, current `stable`, and the cognitive integration lineage.

- [ ] **Step 1: Compare current branch against current `main` and `stable`** and identify overlapping/recent changes.
- [ ] **Step 2: Merge/reconcile without force or destructive reset**; preserve both latest UI-order work and cognitive/runtime work.
- [ ] **Step 3: Run focused session-learning tests and inspect CI**; compare static failures against established baseline so no new regressions are introduced.
- [ ] **Step 4: Merge the final PR to `main`** preserving lineage.
- [ ] **Step 5: Fast-forward `stable` to the exact final `main` SHA**.
- [ ] **Step 6: Compare both directions and require `ahead_by=0`, `behind_by=0`, identical SHA.