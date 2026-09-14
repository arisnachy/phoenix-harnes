# HARDNESS Cognitive Workflow Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, provider-neutral cognitive workflow catalog and router to HARDNESS so PHOENIX knows which reasoning/engineering flows it has, when to activate them, how to compose them, and which quality evidence to require.

**Architecture:** Add pure catalog/selection/adaptation modules inside `@phoenix-ai/dsh-hardness`. Keep execution authority in the existing capability/workflow/subagent systems. Export a model-facing guide and add one concise cognitive-routing requirement to the existing HARDNESS operating protocol. No `agent-loop` changes.

**Tech Stack:** TypeScript, Cordis service package conventions, Vitest, existing HARDNESS provider-neutral contracts.

**Spec:** `docs/superpowers/specs/2026-09-14-hardness-cognitive-workflows-design.md`

## Global Constraints

- Do not patch `agent-loop`.
- Do not add execution or permission authority to cognitive flow selection.
- Preserve the existing `inspect -> resolve -> plan -> approve -> execute -> verify -> present -> audit` protocol.
- Keep cognitive selection pure, deterministic, serializable, and provider-neutral.
- Do not persist or expose private chain-of-thought.
- New behavior must have focused unit coverage and model-facing documentation.

---

### Task 1: Define failing cognitive workflow behavior tests

**Files:**
- Create: `packages/hardness/hardness/tests/cognitive-workflow.spec.ts`

**Interfaces:**
- Consumes: future exports `COGNITIVE_FLOW_CATALOG`, `selectCognitiveWorkflow`, `adaptCognitiveWorkflow`, `renderCognitiveWorkflowGuide`.
- Produces: executable behavioral contract for Tasks 2-4.

- [ ] **Step 1: Write tests for catalog integrity**

Assert 26 unique first-party IDs, every prerequisite resolves, no self-prerequisites, and every dependency precedes its dependent in selected plans.

- [ ] **Step 2: Write mission-selection tests**

Cover simple, build/code, debug/code, research/high-risk, parallel, persistent/repeated, and high-risk missions. Assert required core flows and absence of heavyweight flows for a low-risk simple mission.

- [ ] **Step 3: Write adaptation tests**

Start from a simple/build plan and assert `verification-failed`, `new-risk`, `independent-subtasks-discovered`, and `repeated-failure` monotonically add recovery/escalation/safety flows without removing previously selected flows.

- [ ] **Step 4: Write model-facing guidance test**

Assert rendered guidance contains `brainstorming`, `systematic-debugging`, `verification-gate`, the lightest-safe-workflow rule, root-cause-first debugging, independent parallelism, and the no-private-chain-of-thought instruction.

- [ ] **Step 5: Run focused test and verify RED**

Run: `pnpm vitest run packages/hardness/hardness/tests/cognitive-workflow.spec.ts`
Expected: FAIL because the new exports/modules do not exist.

### Task 2: Implement the cognitive flow catalog and types

**Files:**
- Create: `packages/hardness/hardness/src/cognitive-workflow.ts`
- Modify: `packages/hardness/hardness/src/index.ts`

**Interfaces:**
- Produces: `CognitiveFlowId`, `CognitiveFlowDescriptor`, `CognitiveMissionProfile`, `CognitiveWorkflowPlan`, `CognitiveWorkflowObservation`, `CognitiveQualityGate`, `COGNITIVE_FLOW_CATALOG`.

- [ ] **Step 1: Define immutable public types**

Use readonly fields and literal unions from the design. Keep all values JSON-serializable.

- [ ] **Step 2: Define all 26 descriptors**

Encode purpose, activation guidance, prerequisites, companions, outputs, evidence, cost, and criticality. Validate internal catalog invariants at module construction through a pure assertion helper used by tests.

- [ ] **Step 3: Export through package index**

Add explicit exports without changing `HardnessService` execution authority.

- [ ] **Step 4: Run catalog tests**

Expected: catalog integrity tests pass; selector tests remain RED until Task 3.

### Task 3: Implement deterministic selection and adaptation

**Files:**
- Modify: `packages/hardness/hardness/src/cognitive-workflow.ts`

**Interfaces:**
- Produces: `selectCognitiveWorkflow(profile): CognitiveWorkflowPlan`; `adaptCognitiveWorkflow(plan, observation): CognitiveWorkflowPlan`.

- [ ] **Step 1: Implement canonical order**

Use one stable ordered list and dependency closure so prerequisites always precede dependents.

- [ ] **Step 2: Implement mission selection rules**

Translate each rule from the approved design into deterministic predicates. Every plan must include `intent-framing`, `verification-gate`, and `outcome-evaluation`.

- [ ] **Step 3: Compute quality gates**

Map activated flows to observable gate labels; deduplicate while preserving canonical order.

- [ ] **Step 4: Implement monotonic adaptation**

Map bounded observations to stronger profiles/flows. Preserve every already-selected flow and add necessary recovery/safety/escalation flows.

- [ ] **Step 5: Run focused test**

Run: `pnpm vitest run packages/hardness/hardness/tests/cognitive-workflow.spec.ts`
Expected: all selection/adaptation tests pass except any guidance-only test deferred to Task 4.

### Task 4: Make the capability visible to models through HARDNESS guidance

**Files:**
- Modify: `packages/hardness/hardness/src/cognitive-workflow.ts`
- Modify: `packages/hardness/hardness/src/operating-protocol.ts`
- Modify: `packages/hardness/hardness/src/index.ts`

**Interfaces:**
- Produces: `renderCognitiveWorkflowGuide(locale?)` and cognitive-routing instruction in `renderHardnessProtocol()`.

- [ ] **Step 1: Render concise catalog guidance**

Expose all first-party flow names with activation purpose and the global composition rules. Do not expose reasoning traces.

- [ ] **Step 2: Extend operating protocol guidance**

Before execution planning, instruct the model to classify the mission and choose/adapt the cognitive workflow. Preserve every existing safety and evidence instruction verbatim unless wording must be minimally extended.

- [ ] **Step 3: Run focused tests**

Run: `pnpm vitest run packages/hardness/hardness/tests/cognitive-workflow.spec.ts packages/hardness/hardness/tests/operating-protocol.spec.ts`
Expected: PASS.

### Task 5: Document the capability and integration boundaries

**Files:**
- Modify: `packages/hardness/hardness/README.md`
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: public API from Tasks 2-4.
- Produces: user/developer documentation that distinguishes cognitive orchestration from execution authority.

- [ ] **Step 1: Document first-party flows and selection API**

Add a concise section showing mission profile -> workflow plan -> existing workflow/capability execution.

- [ ] **Step 2: Document architecture placement**

Explain HARDNESS cognitive selection as an inventory/procedural planning layer above existing seams and below model execution policy.

- [ ] **Step 3: Run documentation checks relevant to changed files**

Run package/documentation gates defined by the repository for these docs.

### Task 6: Verification and promotion

**Files:**
- No new implementation files.

**Interfaces:**
- Consumes: completed feature branch.
- Produces: verified commits eligible for `main`, then `stable`.

- [ ] **Step 1: Run focused HARDNESS tests**

Run: `pnpm vitest run packages/hardness/hardness/tests`
Expected: PASS, 0 failures.

- [ ] **Step 2: Run TypeScript/build checks for changed package**

Run the repository-supported typecheck/build commands applicable to `@phoenix-ai/dsh-hardness`.
Expected: exit 0.

- [ ] **Step 3: Review diff against spec**

Verify all 26 flow IDs exist, selection rules match the design, existing approval/verification protocol remains intact, and no execution authority was added.

- [ ] **Step 4: Merge to `main` only after fresh CI evidence**

Use the feature PR and expected head SHA.

- [ ] **Step 5: Port the verified change to `stable`**

Use a stable-target branch/PR based on current `stable`; do not force-move or overwrite unrelated stable history.

## Self-review

- Spec coverage: all design sections map to Tasks 1-6.
- Placeholder scan: no implementation placeholder is accepted as task completion.
- Type consistency: planned public names are identical across tests, implementation, exports, and docs.
- Scope: this plan adds the cognitive routing layer only; durable learning storage and autonomous scheduling remain existing-system consumers, not duplicated runtimes.
