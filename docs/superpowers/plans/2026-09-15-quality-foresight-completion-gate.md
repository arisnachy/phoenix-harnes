# Quality/Foresight Completion Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable PHOENIX quality capability that makes substantial goal completion depend on evidence-backed edge-case challenge, real-vs-simulated observation labels, bounded future-risk forecasts, required repairs, and an explicit innovation disposition before the existing independent judge may certify completion.

**Architecture:** Extend the already-shipped adversarial completion workflow instead of replacing it. A new `ctx.quality` Service Definition owns revision-bound quality assessment state; a session-backed provider persists whole snapshots as `quality/change` events; a model-facing consumer exposes concise read/record tools and standing policy. `dsh-tool-goal` feeds existing independent completion-gate evidence into `ctx.quality` and refuses a substantial/living PASS until quality readiness passes, while the current goal driver remains the only autonomous repair loop.

**Tech Stack:** TypeScript ESM, Cordis Services/plugins, PHOENIX Session event log, Schemastery tool schemas, Vitest, existing goal/subagent completion judge, existing `ctx.living` seam.

**Spec:** `docs/superpowers/specs/2026-09-15-quality-foresight-living-systems-design.md`

## Global Constraints

- Do not create a second autonomous retry loop; `ctx.goals` remains continuation authority.
- Do not create a second living-artifact connector; `ctx.living` remains operational authority.
- Forecasts are hypotheses, not verified lessons or facts.
- Innovation never substitutes for unfinished requested work and may be `not-applicable`.
- Quality may seek evidence but may not broaden tool, sandbox, credential, network, privacy, or approval authority.
- Every model-visible quality fact must be reconstructable from the durable session log.
- Existing `goal/completion-gate`, `goal/judge`, and old session logs remain readable.
- TDD is mandatory: production behavior starts with a failing focused test.
- Promote `main` only after focused verification and CI; move `stable` to the exact verified SHA afterward.

---

### Task 1: Quality vocabulary and readiness rules

**Files:**
- Create: `packages/quality/quality/package.json`
- Create: `packages/quality/quality/tsconfig.json`
- Create: `packages/quality/quality/src/types.ts`
- Create: `packages/quality/quality/src/readiness.ts`
- Create: `packages/quality/quality/src/index.ts`
- Create: `packages/quality/quality/tests/readiness.spec.ts`

**Interfaces:**
- Produces `QualityTaskClass = 'conversational' | 'bounded' | 'substantial' | 'living'`.
- Produces `QualityCriterion`, `QualityScenario`, `RiskForecast`, `QualityInnovation`, `QualityAssessmentSnapshot`, branded `QualityAssessmentId`, and `qualityReadiness(snapshot)`.
- Produces abstract `QualityService extends Service` on `ctx.quality`; Task 2 supplies the provider.

- [ ] **Step 1: Write a failing `readiness.spec.ts` with four concrete assertions.** The fixture has one verified requested criterion, one passing high-severity simulated restart scenario, no forecasts, no required changes, and innovation `not-applicable`. Assert the fixture is ready; changing the scenario to `untested` makes it not ready; adding an `impact: 'high', status: 'open'` forecast makes it not ready; changing the mandatory criterion to `failed` keeps it not ready even when innovation is `implemented`.
- [ ] **Step 2: Run `pnpm exec vitest run packages/quality/quality/tests/readiness.spec.ts`.** Expected RED: module/readiness API does not exist.
- [ ] **Step 3: Implement the minimal types, `QualityService`, and readiness rule.** High/critical scenarios require `pass` or explicit `accepted-risk`; mandatory criteria require `verified`; high/critical open forecasts block; non-empty required changes block; substantial/living require an innovation disposition of `implemented`, `offered`, or `not-applicable`.
- [ ] **Step 4: Re-run the focused test.** Expected GREEN: zero failures.
- [ ] **Step 5: Commit `feat(quality): define assessment readiness contract`.**

### Task 2: Session-backed provider and durable replay

**Files:**
- Create: `packages/quality/quality-session/package.json`
- Create: `packages/quality/quality-session/tsconfig.json`
- Create: `packages/quality/quality-session/src/index.ts`
- Create: `packages/quality/quality-session/src/fold.ts`
- Create: `packages/quality/quality-session/tests/quality-session.spec.ts`
- Modify: `packages/quality/quality/src/types.ts`

**Interfaces:**
- Adds `quality/change` whole-snapshot events with `start | record | clear` operations.
- Implements `SessionQualityService.get(agent)`, `.start(agent, request)`, and `.record(agent, ref, mutation)` with compare-and-set revision checks.

- [ ] **Step 1: Write failing provider tests.** Create a real test session/agent using the same helpers used by `packages/goal/goal/tests`; start an assessment and assert revision 1 is appended as `quality/change`; record a criterion and assert revision 2; replay from events and assert the same snapshot; attempt a write with revision 1 and assert a stale-revision error; recreate the service over the same session and assert state survives.
- [ ] **Step 2: Run `pnpm exec vitest run packages/quality/quality-session/tests/quality-session.spec.ts`.** Expected RED: provider/event fold absent.
- [ ] **Step 3: Implement `QualityChangeMeta`, pure last-wins fold, validation at the durable boundary, and `SessionQualityService`.** Never persist raw telemetry or secrets; clone arrays/records on write and read.
- [ ] **Step 4: Re-run the provider test.** Expected GREEN.
- [ ] **Step 5: Commit `feat(quality): persist revision-bound assessments`.**

### Task 3: Model-facing consumer

**Files:**
- Create: `packages/quality/tool-quality/package.json`
- Create: `packages/quality/tool-quality/tsconfig.json`
- Create: `packages/quality/tool-quality/src/index.ts`
- Create: `packages/quality/tool-quality/tests/tool-quality.spec.ts`
- Create: `packages/quality/tool-quality/README.md`

**Interfaces:**
- Registers `quality_get` and `quality_record`.
- `quality_record` actions: `start`, `criterion`, `scenario`, `forecast`, `required_change`, `innovation`.
- All non-start mutations require exact assessment id/revision from `quality_get`.

- [ ] **Step 1: Write failing tool tests.** Assert prompt text says `live` evidence must be authoritative, forecasts remain hypotheses, material open risks require repair/acceptance, and innovation follows completion. Assert stale revision rejects. Assert `not-applicable` innovation is accepted. Assert a `live` scenario without evidence is rejected at the tool boundary.
- [ ] **Step 2: Run `pnpm exec vitest run packages/quality/tool-quality/tests/tool-quality.spec.ts`.** Expected RED.
- [ ] **Step 3: Implement the two tools and standing prompt section over `ctx.quality`; do not add autonomous execution or living control.**
- [ ] **Step 4: Re-run the focused test.** Expected GREEN.
- [ ] **Step 5: Commit `feat(quality): expose evidence and foresight tools`.**

### Task 4: Integrate foresight with the existing adversarial completion gate

**Files:**
- Modify: `packages/goal/tool-goal/src/completion-gate.ts`
- Modify: `packages/goal/tool-goal/src/judge.ts`
- Modify: `packages/goal/tool-goal/package.json`
- Modify: `packages/goal/tool-goal/tests/adversarial-completion-gate.spec.ts`
- Modify: `packages/goal/tool-goal/tests/judge.spec.ts`

**Interfaces:**
- Extends ephemeral `GoalCompletionGateResult` with `realWorldScenarios`, `riskForecasts`, and `innovationOpportunity`; historical `goal/completion-gate` payload remains unchanged.
- `judgeGoalCompletion` mirrors current gate evidence into mounted `ctx.quality` and requires `qualityReadiness()` for substantial/living assessments.

- [ ] **Step 1: Add failing tests in `adversarial-completion-gate.spec.ts`.** The structured executor must reject `evidence_kind: 'live'` with an empty evidence list; preserve `simulated` as simulated; return a high-impact open forecast as unresolved; and accept innovation `not-applicable` with a non-empty rationale.
- [ ] **Step 2: Add a failing judge test.** Mount a quality assessment with one unresolved high forecast, feed otherwise passing gate/judge outputs, and assert final verdict is `needs_changes`; change the forecast to mitigated and assert the same semantic judge pass can be accepted.
- [ ] **Step 3: Run `pnpm exec vitest run packages/goal/tool-goal/tests/adversarial-completion-gate.spec.ts packages/goal/tool-goal/tests/judge.spec.ts`.** Expected RED.
- [ ] **Step 4: Extend the independent schemas/prompts.** Scenario fields: `id,title,severity,status,evidence_kind,evidence,blocker`; forecast fields: `id,scenario,likelihood,confidence,impact,evidence,mitigation,status`; innovation fields: `status,rationale,evidence`. Prompt asks what could fail after delivery, trigger conditions, real-vs-simulated evidence, and what should be repaired before delivery.
- [ ] **Step 5: Add optional `quality` integration in the goal consumer.** Mirror criteria, scenarios, forecasts, required changes and innovation from the current gate into the exact active quality assessment. If quality is absent, retain current completion behavior; Task 5 makes it present in normal profiles.
- [ ] **Step 6: Enforce readiness before PASS.** Convert unresolved quality blockers to concrete `needs_changes`; never promote forecasts to facts.
- [ ] **Step 7: Re-run both tests.** Expected GREEN.
- [ ] **Step 8: Commit `feat(goal): gate completion on quality foresight evidence`.**

### Task 5: Composition and runnable regression

**Files:**
- Modify: `packages/bundle/base/cordis.patch.yml`
- Modify: `packages/bundle/base/package.json`
- Modify: `packages/bundle/base/tests/base.spec.ts`
- Modify: `apps/cli/config/agent-presets/standard/agent.cordis.yml`
- Modify: `apps/cli/config/agent-presets/code/agent.cordis.yml`
- Modify: `examples/acp-agent/tests/goal.snapshot.ts`
- Create: `examples/acp-agent/tests/goal-snapshots/quality-foresight/input.json`
- Create: `examples/acp-agent/tests/goal-snapshots/quality-foresight/session.expected.jsonl`
- Create: `examples/acp-agent/tests/goal-snapshots/quality-foresight/stdout.expected.jsonl`

**Interfaces:**
- Base profile mounts `quality-session` before `tool-quality`/`tool-goal`.
- Snapshot proves a substantial mission cannot complete while a material forecast is open and completes after repair plus innovation disposition.

- [ ] **Step 1: Add a failing base-bundle assertion for all quality packages and dependency order.**
- [ ] **Step 2: Run `pnpm exec vitest run packages/bundle/base/tests/base.spec.ts`.** Expected RED.
- [ ] **Step 3: Mount quality packages in base and presets, including package dependencies.**
- [ ] **Step 4: Re-run base test.** Expected GREEN.
- [ ] **Step 5: Add the keyless quality-foresight goal fixture and expected transcript showing `needs_changes` then repair then pass.**
- [ ] **Step 6: Run the exact goal snapshot test entry for `quality-foresight`.** Expected GREEN.
- [ ] **Step 7: Commit `feat(bundle): mount quality foresight runtime`.**

### Task 6: Documentation and generated surfaces

**Files:**
- Create: `packages/quality/README.md`
- Create: `docs/subsystems/quality.md`
- Create: `.agents/notes/implemented/architecture/2026-09-15-quality-foresight-completion-runtime.md`
- Modify: `packages/README.md`
- Modify: `docs/architecture.md`
- Regenerate repository-owned catalogs affected by the new service, event, config and tools.

- [ ] **Step 1: Document `ctx.quality` as evidence-backed completion readiness; link `ctx.goals` for continuation/judging and `ctx.living` for operational control.**
- [ ] **Step 2: Run the repository catalog generators used by `doc-sync`.**
- [ ] **Step 3: Run `pnpm run doc-sync`.** Expected exit 0.
- [ ] **Step 4: Commit `docs: document quality foresight capability`.**

### Task 7: Verification and promotion

- [ ] **Step 1: Run focused tests:** `pnpm exec vitest run packages/quality/quality/tests packages/quality/quality-session/tests packages/quality/tool-quality/tests packages/goal/tool-goal/tests/adversarial-completion-gate.spec.ts packages/goal/tool-goal/tests/judge.spec.ts packages/bundle/base/tests/base.spec.ts`. Expected exit 0.
- [ ] **Step 2: Run `pnpm run typecheck`.** Expected exit 0.
- [ ] **Step 3: Run `pnpm run build`.** Expected exit 0.
- [ ] **Step 4: Run `pnpm run doc-sync`.** Expected exit 0.
- [ ] **Step 5: Run `git diff --check` and inspect branch diff for unrelated files/secrets.** Expected clean.
- [ ] **Step 6: Require the implementation PR/feature SHA to have green CI.**
- [ ] **Step 7: Fast-forward `main` to the verified feature SHA and re-check CI/status at that exact SHA.**
- [ ] **Step 8: Fast-forward `stable` to the exact same SHA.**
- [ ] **Step 9: Compare `stable...main`.** Expected `identical`; report the shared SHA and verification evidence.
