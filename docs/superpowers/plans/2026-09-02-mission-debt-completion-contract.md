# Mission Debt Completion Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent PHOENIX from ending executable work with unresolved “pending/not yet” items by converting that condition into a durable active goal and keeping HARDNESS capability gaps recoverable until a verified product is delivered or a true external dependency is proven.

**Architecture:** Keep the generic agent loop unchanged. Add a narrow mission-debt detector to `goal-round-driver`; at the existing `agent/turn-stopping` extension point it bootstraps a persistent goal only for a top-level direct-human turn that actually executed tools and whose final assistant text explicitly leaves unresolved work. Preserve the existing goal continuation, adversarial completion gate, clean-room evidence, and independent judge. HARDNESS capability/executor gaps remain recovery events rather than being prematurely classified as external blockers.

**Tech Stack:** TypeScript, Cordis events, Vitest, PHOENIX goal/HARDNESS packages, GitHub Actions CI.

**Spec:** User-approved mission completion contract from 2026-09-02: unresolved work is internal mission debt; completion requires the final requested product at high quality; failures trigger learning/replanning; missing tools/capabilities must be acquired or built before declaring an external blocker.

## Global Constraints

- Do not change the generic `agent-loop`; use documented plugin extension points.
- Do not auto-create goals for ordinary informational turns with no executable tool work.
- Preserve direct-human authority and root-agent checks.
- Preserve the existing adversarial completion gate and independent judge as the only completion path.
- Round/attempt limits bound an execution window, not the mission.
- Only genuine user authorization, credentials, physical action, or unavailable external infrastructure may become `WAITING_EXTERNAL`.
- No secrets or credentials in durable events, docs, tests, or commits.

---

### Task 1: Mission-debt detector

**Files:**
- Create: `packages/goal/goal-round-driver/src/mission-debt.ts`
- Test: `packages/goal/goal-round-driver/tests/mission-debt.spec.ts`

**Interfaces:**
- Consumes: `readonly SessionEvent[]`, current turn number.
- Produces: `missionDebtBootstrap(events, turn): { objective: string; evidence: string } | undefined`.

- [ ] Write failing tests for Spanish `**Pendiente:**`, Spanish `todavía no`, English `Pending:`, and negative controls such as `No hay nada pendiente` and ordinary text-only questions.
- [ ] Implement bounded text extraction for the current turn, direct-human objective detection (`source.kind === 'user'`), tool-call evidence, and explicit unresolved-debt detection.
- [ ] Run the focused detector tests.

### Task 2: Automatic persistent recovery

**Files:**
- Modify: `packages/goal/goal-round-driver/src/index.ts`
- Test: `packages/goal/goal-round-driver/tests/goal-round-driver.spec.ts`

**Interfaces:**
- Consumes: `missionDebtBootstrap` from Task 1.
- Produces: automatic `ctx.goals.create(...)` at `agent/turn-stopping` only when no current goal exists and the detector proves direct-human executable debt.

- [ ] Add a regression test reproducing the Hostinger-style final response with `Pendiente:` after tool work and verify the turn bootstraps an active, armed goal instead of ending the mission.
- [ ] Add a negative regression proving an ordinary successful tool-assisted answer without debt does not create a goal.
- [ ] Install the guard on `agent/turn-stopping`, root-agent only, fail-closed on projection errors, and rely on the existing goal driver for subsequent rounds.
- [ ] Run the focused goal-round-driver tests.

### Task 3: HARDNESS recovery semantics

**Files:**
- Modify: `packages/hardness/adapters/src/mission-orchestrator.ts`
- Test: `packages/hardness/adapters/tests/mission-orchestrator.spec.ts`

**Interfaces:**
- Existing `HardnessMissionResult` remains source-compatible.
- Capability absence and missing executor return `status: 'RECOVERING'` with a recovery next action until alternatives/build routes are exhausted by the mission, rather than immediately claiming `WAITING_EXTERNAL`.

- [ ] Add failing tests for missing capability and missing executor being recoverable mission debt.
- [ ] Change only recoverable technical gaps; keep explicit approval denial/external human authority as waiting external.
- [ ] Ensure the automatic recovery bound is described as a strategy-window boundary, never mission completion.
- [ ] Run focused HARDNESS tests.

### Task 4: Documentation and decision record

**Files:**
- Modify: `packages/goal/goal-round-driver/README.md`
- Modify: `packages/hardness/adapters/README.md`
- Create: `.agents/notes/implemented/bug-fix/2026-09-02-mission-debt-completion-contract.md`

**Interfaces:** Documentation must state the same runtime invariants as code.

- [ ] Document that explicit unresolved debt after executable work auto-enters the persistent mission lifecycle.
- [ ] Document that technical capability gaps are recoverable until a true external dependency is established.
- [ ] Record rationale, alternatives rejected, consequences, and verification evidence in the Agent Note.

### Task 5: Verification and propagation

**Files:** No new product files unless verification exposes a defect.

- [ ] Run focused tests, typecheck/build/hygiene gates required by the touched packages through CI.
- [ ] Inspect CI failures and fix product/test defects rather than bypassing gates.
- [ ] Merge the verified commit into `main`.
- [ ] Compare `main` and `stable`, propagate the exact verified change without overwriting stable-only history.
- [ ] Verify the stable update path/CI after propagation.
