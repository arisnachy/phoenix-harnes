# HARDNESS Autonomy Fast Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Phoenix use a deterministic fast path for bounded work, make HARDNESS authoritative over process ceremony, and continue autonomously through recoverable obstacles until verified completion.

**Architecture:** Extend the pure HARDNESS workflow router with an execution-mode classifier and make fast-mode selection skip heavyweight design/review flows. Keep the generic skill catalog unchanged; express process authority in the HARDNESS system prompt, while the existing mission orchestrator and goal-round driver remain the only recovery/continuation engines.

**Tech Stack:** TypeScript, Cordis plugins, Vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-14-hardness-autonomy-fast-path-design.md`

## Global Constraints

- Preserve explicit permission/account-authorization, safety, provider-quota, user-denial, and genuine external-dependency boundaries.
- Do not add a second mission continuation engine; reuse the mission orchestrator and goal-round driver.
- Do not couple generic `tool-skill` catalog state to HARDNESS process state.
- Model-visible policy changes require focused tests plus a keyless real-Loader snapshot.
- Non-trivial package changes update the owning Agent Note and affected package documentation.

---

### Task 1: Add deterministic execution modes to HARDNESS

**Files:**
- Modify: `packages/hardness/hardness/src/cognitive-workflow.ts`
- Modify: `packages/hardness/hardness/src/index.ts`
- Test: `packages/hardness/hardness/tests/autonomy-fast-path.spec.ts`

**Interfaces:**
- Produces: `CognitiveExecutionMode = 'fast' | 'standard' | 'deep'`
- Produces: `CognitiveWorkflowPlan.executionMode`
- Preserves: `selectCognitiveWorkflow(profile)` and `adaptCognitiveWorkflow(plan, observation)`

- [x] **Step 1: Write failing tests** for bounded fast mode and deep escalation.
- [x] **Step 2: Observe RED evidence** before production implementation.
- [x] **Step 3: Implement execution-mode classification and fast-path flow selection.**
- [x] **Step 4: Export the new public type and preserve monotonic escalation.**

### Task 2: Project execution mode through the model-facing tool

**Files:**
- Modify: `packages/hardness/adapters/src/cognitive-workflow-tool.ts`
- Test: `packages/hardness/adapters/tests/cognitive-workflow-mode.spec.ts`

**Interfaces:**
- Consumes: `CognitiveWorkflowPlan.executionMode`
- Produces: tool output field `executionMode`

- [x] **Step 1: Add a failing adapter test.**
- [x] **Step 2: Add `executionMode` to the projected result and output schema.**
- [ ] **Step 3: Confirm GREEN on the final head.**

### Task 3: Make HARDNESS authoritative over process-skill ceremony

**Files:**
- Modify: `packages/hardness/hardness/src/cognitive-workflow.ts`
- Test: `packages/hardness/hardness/tests/autonomy-fast-path.spec.ts`

**Interfaces:**
- Produces: higher-priority HARDNESS prompt guidance declaring selected flows to be process policy.
- Preserves: generic skill catalog behavior and domain-skill discovery.

- [x] **Step 1: Add a failing guide test** for HARDNESS process authority and fast-mode language.
- [x] **Step 2: Keep `tool-skill` unchanged after review showed catalog coupling could become stale.**
- [x] **Step 3: Put methodology/process authority in `renderCognitiveWorkflowGuide()`.**
- [ ] **Step 4: Confirm assembled prompt through the keyless Loader snapshot.**

### Task 4: Convert recoverable protocol failures into autonomous recovery

**Files:**
- Modify: `packages/hardness/hardness/src/operating-protocol.ts`
- Modify: `packages/hardness/hardness/tests/operating-protocol.spec.ts`
- Test: `packages/hardness/hardness/tests/autonomous-recovery-protocol.spec.ts`

**Interfaces:**
- Preserves: unresolved routes and permission conflicts as execution-blocked.
- Changes: execution, verification, and presentation failures return `continue` with repair/alternative/acquire actions; unresolved routes require alternatives/acquisition/build before routine handoff.

- [x] **Step 1: Add failing recovery tests.**
- [x] **Step 2: Preserve the permission-sensitive unresolved-route boundary found during review.**
- [x] **Step 3: Implement fail-forward execution/verification/presentation views and EN/ES guidance.**
- [ ] **Step 4: Confirm GREEN on the final head.**

### Task 5: Reinforce active-goal autonomy without duplicating the driver

**Files:**
- Modify: `packages/goal/goal-round-driver/src/prompt.ts`
- Test: `packages/goal/goal-round-driver/tests/autonomy-prompt.spec.ts`

**Interfaces:**
- Preserves: `renderGoalRoundPrompt(goal, round, feedback?, strategy?)`
- Changes: active rounds do not pause for routine process-skill/plan ceremony; internal retry/window limits rotate strategy rather than complete the mission.

- [x] **Step 1: Add a failing prompt assertion.**
- [x] **Step 2: Add minimal autonomous-continuation clauses without new lifecycle state.**
- [ ] **Step 3: Confirm GREEN on the final head.**

### Task 6: Prove the assembled model-visible policy

**Files:**
- Create: `packages/hardness/adapters/tests/snapshots/autonomy-policy.snapshot.ts`
- Modify: `vitest.snapshot.config.ts`

**Interfaces:**
- Boots: real Cordis Loader + real SystemPrompt + real HARDNESS protocol registrar.
- Observes: assembled model prompt, keyless and deterministic.

- [x] **Step 1: Add the Loader snapshot and inline expected policy lines.**
- [x] **Step 2: Register the HARDNESS snapshot path in the snapshot Vitest config.**
- [ ] **Step 3: Run `test:snapshot` evidence on the final head.**

### Task 7: Document and verify the integrated behavior

**Files:**
- Update: `.agents/notes/implemented/feature/2026-09-14-hardness-cognitive-workflows.md`
- Update paired Chinese note and i18n sidecar.
- Update affected HARDNESS/adapters/goal-round-driver README pairs and sidecars.

**Interfaces:**
- Documents: execution modes, HARDNESS process authority, fail-forward recovery, hard completion, and preserved safety boundaries.

- [ ] **Step 1: Update the owning Agent Note and package documentation in current-state prose.**
- [ ] **Step 2: Inspect the exact PR diff and ensure no generic `tool-skill` change remains.**
- [ ] **Step 3: Run/fetch fresh CI for the final PR head; compare any failures with current `main`.**
- [ ] **Step 4: Reconcile/merge onto the latest concurrent `main` without losing Connectors Hub.**
- [ ] **Step 5: Fast-forward `stable` with `force=false` and verify `main == stable`.**
