# HARDNESS Autonomy Fast Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Phoenix use a deterministic fast path for bounded work, defer process-skill ceremony to HARDNESS, and continue autonomously through recoverable obstacles until verified completion.

**Architecture:** Extend the pure HARDNESS workflow router with an execution-mode classifier and make fast-mode selection skip heavyweight design/review flows. Align model-facing skill-catalog and operating/goal-round guidance so HARDNESS owns process methodology, while the existing mission orchestrator and goal-round driver remain the only recovery/continuation engines.

**Tech Stack:** TypeScript, Cordis plugins, Vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-14-hardness-autonomy-fast-path-design.md`

## Global Constraints

- Preserve explicit permission, credential, safety, provider-quota, and genuine external-dependency boundaries.
- Do not add a second mission continuation engine; reuse the mission orchestrator and goal-round driver.
- Model-visible policy changes require focused tests and must remain reconstructable from durable/model-visible sources.
- Non-trivial package changes include an Agent Note and affected README/JSDoc updates when public behavior changes.

---

### Task 1: Add deterministic execution modes to HARDNESS

**Files:**
- Modify: `packages/hardness/hardness/src/cognitive-workflow.ts`
- Test: `packages/hardness/hardness/tests/cognitive-workflow.spec.ts`

**Interfaces:**
- Produces: `CognitiveExecutionMode = 'fast' | 'standard' | 'deep'`
- Produces: `CognitiveWorkflowPlan.executionMode`
- Preserves: `selectCognitiveWorkflow(profile)` and `adaptCognitiveWorkflow(plan, observation)`

- [ ] **Step 1: Write failing tests** proving a bounded low-novelty code/UI mission returns `executionMode: 'fast'` and omits brainstorming, architecture design, implementation planning, adversarial critique, and independent judge; prove a high-risk or previously failed mission returns `deep` and keeps stronger flows.
- [ ] **Step 2: Run the focused cognitive-workflow test** and confirm the new assertions fail because `executionMode` and fast-path selection do not exist.
- [ ] **Step 3: Implement the minimal execution-mode classifier and fast-path branching** inside the pure router.
- [ ] **Step 4: Run the focused test again** and confirm all cognitive-workflow tests pass.

### Task 2: Project execution mode through the model-facing tool

**Files:**
- Modify: `packages/hardness/adapters/src/cognitive-workflow-tool.ts`
- Test: `packages/hardness/adapters/tests/cognitive-workflow-tool.spec.ts`

**Interfaces:**
- Consumes: `CognitiveWorkflowPlan.executionMode`
- Produces: tool output field `executionMode`

- [ ] **Step 1: Add a failing adapter test** asserting `hardness_workflow` returns `executionMode` with the selected flows and quality gates.
- [ ] **Step 2: Run the focused adapter test** and confirm it fails because the field is not projected.
- [ ] **Step 3: Add `executionMode` to the projected tool result and output schema.**
- [ ] **Step 4: Run the adapter test** and confirm it passes.

### Task 3: Make HARDNESS authoritative over process-skill ceremony

**Files:**
- Modify: `packages/skill/tool-skill/src/index.ts`
- Test: `packages/skill/tool-skill/tests/index.spec.ts` or the owning catalog test file discovered in the package

**Interfaces:**
- Consumes: visibility of the `hardness_workflow` tool from the current agent scope.
- Produces: model-facing catalog guidance that defers process/methodology skill loading until HARDNESS selects the workflow.

- [ ] **Step 1: Add a failing catalog test** that renders the skill catalog with `hardness_workflow` visible and asserts the guidance requires HARDNESS-first process selection, forbids preloading heavyweight process skills by apparent relevance alone, and still permits domain-skill loading.
- [ ] **Step 2: Run the focused tool-skill test** and confirm the assertion fails against current catalog prose.
- [ ] **Step 3: Change only the catalog guidance** so process/methodology skills are deferred to the selected HARDNESS flows while domain skills remain task-driven.
- [ ] **Step 4: Run the focused test** and confirm it passes.

### Task 4: Convert recoverable protocol failures into autonomous recovery

**Files:**
- Modify: `packages/hardness/hardness/src/operating-protocol.ts`
- Test: `packages/hardness/hardness/tests/operating-protocol.spec.ts`

**Interfaces:**
- Preserves: `HardnessProtocolOutcome` values for compatibility.
- Changes: recoverable route, execution, verification, and presentation failures return `outcome: 'continue'` with repair/alternative/acquire actions; permission denial and policy conflicts remain blocked.

- [ ] **Step 1: Replace/add tests** so missing/unknown routes, execution failure, verification failure, and presentation failure expect autonomous recovery actions and `continue`, while approval denial remains blocked.
- [ ] **Step 2: Run the focused operating-protocol test** and confirm the new recovery expectations fail.
- [ ] **Step 3: Implement fail-forward protocol views** and update Spanish/English rendered guidance to forbid routine user handoffs and require alternative/acquisition/build paths before reporting a blocker.
- [ ] **Step 4: Run the focused test** and confirm it passes.

### Task 5: Reinforce active-goal autonomy without duplicating the driver

**Files:**
- Modify: `packages/goal/goal-round-driver/src/prompt.ts`
- Test: `packages/goal/goal-round-driver/tests/goal-round-driver.spec.ts`

**Interfaces:**
- Preserves: `renderGoalRoundPrompt(goal, round, feedback?, strategy?)`
- Changes: active rounds explicitly ignore routine process-skill approval ceremonies and continue through recoverable obstacles until verified completion.

- [ ] **Step 1: Add a failing prompt assertion** for “do not pause for process-skill ceremony / routine plan approval” and “internal attempt limits do not complete the mission”.
- [ ] **Step 2: Run the focused goal-round-driver test** and confirm it fails on missing guidance.
- [ ] **Step 3: Add the minimal prompt clauses** without changing lifecycle state or introducing new driver state.
- [ ] **Step 4: Run the focused goal-round-driver test** and confirm it passes.

### Task 6: Document and verify the integrated behavior

**Files:**
- Create: `.agents/notes/implemented/feature/2026-09-14-hardness-autonomy-fast-path.md`
- Modify as required by package documentation checks: HARDNESS/skill/goal-round-driver README files only where the changed model-visible contract is documented.

**Interfaces:**
- Documents: execution modes, HARDNESS process authority, fail-forward recovery, completion semantics, and preserved safety boundaries.

- [ ] **Step 1: Add the Agent Note** in current-state prose with rationale, rejected alternatives, and verification evidence.
- [ ] **Step 2: Run focused tests for all touched packages** and record exact outcomes.
- [ ] **Step 3: Run repository diff checks / relevant static checks available in CI**; do not claim global all-green if inherited failures remain.
- [ ] **Step 4: Open/update the PR, inspect its exact diff, and verify it contains only the intended files.**
- [ ] **Step 5: Merge to `main` only after fresh evidence, then fast-forward `stable` with `force=false` and verify `main == stable`.**
