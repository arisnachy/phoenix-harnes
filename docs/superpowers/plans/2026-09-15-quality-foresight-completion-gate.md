# Quality/Foresight Completion Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable PHOENIX quality capability that makes substantial goal completion depend on evidence-backed edge-case challenge, real-vs-simulated observation labels, bounded future-risk forecasts, required repairs, and an explicit innovation disposition before the existing independent judge may certify completion.

**Architecture:** Extend the already-shipped adversarial completion workflow instead of replacing it. A new `ctx.quality` Service Definition owns revision-bound quality assessment state; a session-backed provider persists full snapshots as `quality/change` events; a model-facing consumer exposes concise read/record tools and standing policy. `dsh-tool-goal` feeds the existing independent completion-gate evidence into `ctx.quality` and refuses a substantial/living PASS until the quality assessment is ready, while the current goal driver remains the only autonomous repair loop.

**Tech Stack:** TypeScript ESM, Cordis Services/plugins, PHOENIX Session event log/projections, Schemastery tool schemas, Vitest, existing goal/subagent completion judge, existing `ctx.living` seam.

**Spec:** `docs/superpowers/specs/2026-09-15-quality-foresight-living-systems-design.md`

## Global Constraints

- Do not create a second autonomous retry loop; `ctx.goals` remains the continuation authority.
- Do not create a second living-artifact connector; `ctx.living` remains the operational authority for Phoenix-created systems.
- Forecasts are hypotheses, not verified lessons or facts.
- Innovation never substitutes for unfinished requested work and may be `not-applicable`.
- The quality capability may seek evidence but may not broaden tool, sandbox, credential, network, privacy, or approval authority.
- Every new model-visible quality fact must be reconstructable from the durable session log.
- Existing `goal/completion-gate`, `goal/judge`, and old session logs remain readable; additive fields or a new event family must not require rewriting prior logs.
- TDD is mandatory: each production behavior starts with a failing focused test.
- `main` is promoted only after focused tests plus required package/build/doc gates pass; `stable` moves to the exact verified commit only after `main` is verified.

---

### Task 1: Quality vocabulary and pure readiness rules

**Files:**
- Create: `packages/quality/quality/package.json`
- Create: `packages/quality/quality/tsconfig.json`
- Create: `packages/quality/quality/tsconfig.build.json`
- Create: `packages/quality/quality/src/types.ts`
- Create: `packages/quality/quality/src/readiness.ts`
- Create: `packages/quality/quality/src/index.ts`
- Create: `packages/quality/quality/tests/readiness.spec.ts`
- Create: `packages/quality/quality/tests/loader.spec.ts`

**Interfaces:**
- Produces `QualityTaskClass = 'conversational' | 'bounded' | 'substantial' | 'living'`.
- Produces `QualityCriterion`, `QualityEvidence`, `QualityScenario`, `RiskForecast`, `QualityInnovation`, `QualityAssessmentSnapshot`, and branded `QualityAssessmentId`.
- Produces `qualityReadiness(snapshot): { ready: boolean; blockers: string[] }`.
- Produces abstract `QualityService extends Service` on `ctx.quality` with `get(agent)`, `start(agent, request)`, and `record(agent, ref, mutation)`; Task 2 supplies the provider.

- [ ] **Step 1: Write the failing readiness tests.**

```ts
import { describe, expect, test } from 'vitest'
import { qualityReadiness, type QualityAssessmentSnapshot } from '../src/index.ts'

const base = (): QualityAssessmentSnapshot => ({
  id: 'qa-1' as never,
  revision: 1,
  objective: 'Ship a resilient service',
  taskClass: 'substantial',
  criteria: [{ id: 'REQ-1', text: 'Service starts', tier: 'requested', mandatory: true, status: 'verified', evidence: ['test:start'] }],
  scenarios: [{ id: 'EDGE-1', title: 'restart', severity: 'high', status: 'pass', evidenceKind: 'simulated', evidence: ['test:restart'] }],
  forecasts: [],
  requiredChanges: [],
  innovation: { status: 'not-applicable', rationale: 'No responsible extra feature adds value.' },
  createdAt: 1,
  updatedAt: 1,
})

describe('qualityReadiness', () => {
  test('accepts substantial work only when mandatory criteria and material scenarios are resolved', () => {
    expect(qualityReadiness(base())).toEqual({ ready: true, blockers: [] })
  })

  test('rejects an unresolved high-severity scenario', () => {
    const snapshot = base()
    snapshot.scenarios[0] = { ...snapshot.scenarios[0], status: 'untested', blocker: 'provider offline' }
    expect(qualityReadiness(snapshot).ready).toBe(false)
  })

  test('rejects a high-impact forecast that has no mitigation or explicit acceptance', () => {
    const snapshot = base()
    snapshot.forecasts = [{
      id: 'RISK-1', scenario: 'queue saturation', likelihood: 'high', confidence: 'medium', impact: 'high',
      evidence: ['metric:throughput'], mitigation: '', status: 'open',
    }]
    expect(qualityReadiness(snapshot).ready).toBe(false)
  })

  test('never treats an innovation as compensation for an unmet requested criterion', () => {
    const snapshot = base()
    snapshot.criteria[0] = { ...snapshot.criteria[0], status: 'failed' }
    snapshot.innovation = { status: 'implemented', rationale: 'Added dashboard', evidence: ['test:dashboard'] }
    expect(qualityReadiness(snapshot).ready).toBe(false)
  })
})
```

- [ ] **Step 2: Run the focused test and confirm RED.**

Run: `pnpm exec vitest run packages/quality/quality/tests/readiness.spec.ts`
Expected: FAIL because `@phoenix-ai/dsh-quality` and `qualityReadiness` do not exist.

- [ ] **Step 3: Implement the minimal vocabulary and pure readiness function.**

`QualityScenario.status` is `pending | pass | fail | untested | accepted-risk`; `severity` is `low | medium | high | critical`; `evidenceKind` is `static | simulated | live`. `RiskForecast.status` is `open | mitigated | accepted | confirmed | contradicted | unknown`. Readiness rejects mandatory criteria not `verified`, high/critical scenarios not `pass` or `accepted-risk`, high-impact forecasts still `open`, non-empty `requiredChanges`, and missing innovation disposition on `substantial`/`living`. `conversational` and `bounded` use only the fields supplied and do not require an innovation record.

- [ ] **Step 4: Run readiness tests and confirm GREEN.**

Run: `pnpm exec vitest run packages/quality/quality/tests/readiness.spec.ts`
Expected: PASS with zero failures.

- [ ] **Step 5: Add a loader test proving the abstract service cannot be mounted directly and `ctx.quality` is declared.**

Run: `pnpm exec vitest run packages/quality/quality/tests/loader.spec.ts`
Expected before implementation: FAIL; after the minimal Service Definition is added: PASS.

- [ ] **Step 6: Commit Task 1.**

```bash
git add packages/quality/quality
git commit -m "feat(quality): define assessment readiness contract"
```

### Task 2: Session-backed quality provider and durable replay

**Files:**
- Create: `packages/quality/quality-session/package.json`
- Create: `packages/quality/quality-session/tsconfig.json`
- Create: `packages/quality/quality-session/tsconfig.build.json`
- Create: `packages/quality/quality-session/src/index.ts`
- Create: `packages/quality/quality-session/src/fold.ts`
- Create: `packages/quality/quality-session/tests/quality-session.spec.ts`
- Modify: `packages/quality/quality/src/types.ts`

**Interfaces:**
- Adds durable `quality/change` session event with whole-snapshot `start | record | clear` mutations.
- Provider class `SessionQualityService extends QualityService` implements `get`, `start`, and `record` against the exact live agent session.
- `record` is compare-and-set on `{ id, revision }`; every accepted mutation increments `revision` and persists the complete post-change snapshot.

- [ ] **Step 1: Write failing replay/CAS tests.** Cover start, replay from session events, stale revision rejection, criteria/scenario/forecast/required-change/innovation mutations, and preservation across service restart.
- [ ] **Step 2: Run `pnpm exec vitest run packages/quality/quality-session/tests/quality-session.spec.ts` and confirm RED because provider/event fold is absent.**
- [ ] **Step 3: Implement `quality/change` payloads in `quality/src/types.ts`, a pure last-wins fold, and `SessionQualityService`.** Validate normalized IDs/text at the durable boundary; never persist raw telemetry or secrets.
- [ ] **Step 4: Re-run the focused provider tests and confirm GREEN.**
- [ ] **Step 5: Commit Task 2.**

```bash
git add packages/quality/quality packages/quality/quality-session
git commit -m "feat(quality): persist revision-bound assessments"
```

### Task 3: Model-facing quality consumer

**Files:**
- Create: `packages/quality/tool-quality/package.json`
- Create: `packages/quality/tool-quality/tsconfig.json`
- Create: `packages/quality/tool-quality/tsconfig.build.json`
- Create: `packages/quality/tool-quality/src/index.ts`
- Create: `packages/quality/tool-quality/tests/tool-quality.spec.ts`
- Create: `packages/quality/tool-quality/README.md`

**Interfaces:**
- Registers `quality_get` and `quality_record` tools; `quality_record` supports actions `start`, `criterion`, `scenario`, `forecast`, `required_change`, and `innovation`.
- `start` records objective and `task_class`; all later actions require exact `assessment_id` and `revision` from `quality_get`.
- Prompt policy states: substantial/living work must challenge relevant edge cases; label evidence `static`, `simulated`, or `live` truthfully; forecasts are hypotheses; unresolved material risks require repair or explicit risk acceptance; innovation is considered only after requested work is complete.

- [ ] **Step 1: Write failing tool tests for strict CAS, evidence labels, forecast status, innovation `not-applicable`, and prompt guidance.**
- [ ] **Step 2: Run `pnpm exec vitest run packages/quality/tool-quality/tests/tool-quality.spec.ts` and confirm RED.**
- [ ] **Step 3: Implement the minimal tools over `ctx.quality`; do not add autonomous execution or living control here.**
- [ ] **Step 4: Re-run the focused tool tests and confirm GREEN.**
- [ ] **Step 5: Commit Task 3.**

```bash
git add packages/quality/tool-quality
git commit -m "feat(quality): expose evidence and foresight tools"
```

### Task 4: Feed the independent adversarial gate into quality state

**Files:**
- Modify: `packages/goal/tool-goal/src/completion-gate.ts`
- Modify: `packages/goal/tool-goal/src/judge.ts`
- Modify: `packages/goal/tool-goal/package.json`
- Modify: `packages/goal/tool-goal/tests/completion-gate.spec.ts`
- Modify: `packages/goal/tool-goal/tests/judge.spec.ts`

**Interfaces:**
- Extend `GoalCompletionGateResult` additively with `realWorldScenarios`, `riskForecasts`, and `innovationOpportunity`; older durable `goal/completion-gate` events remain valid because these fields are not added to that historical event.
- Independent tester output must distinguish `simulated` from `live` evidence and cannot claim live observation without an authoritative runtime/tool path.
- `judgeGoalCompletion` mirrors gate findings into the current `ctx.quality` assessment when mounted and uses `qualityReadiness()` as an additional completion precondition for `substantial`/`living` assessments.

- [ ] **Step 1: Add failing completion-gate tests proving the structured parser rejects a claimed `live` scenario with no live evidence reference, rejects a high-impact open forecast, and accepts innovation `not-applicable`.**
- [ ] **Step 2: Run the two focused test files and confirm RED.**

Run: `pnpm exec vitest run packages/goal/tool-goal/tests/completion-gate.spec.ts packages/goal/tool-goal/tests/judge.spec.ts`

- [ ] **Step 3: Extend the independent test-design/execution schemas and prompts.** A scenario records id/title/severity/status/evidence_kind/evidence/blocker; a forecast records scenario/likelihood/confidence/impact/evidence/mitigation/status; innovation records status/rationale/evidence. Prompt explicitly asks what can fail after delivery, what conditions trigger it, and what should be repaired now.
- [ ] **Step 4: Add `quality` as an optional service dependency in the goal consumer and mirror the current gate evidence into the exact active quality assessment.** If no assessment is mounted, preserve current completion behavior; the base profile in Task 5 makes it present for normal Phoenix sessions.
- [ ] **Step 5: Enforce readiness before a judge PASS can complete a substantial/living quality assessment.** Return `needs_changes` with quality blockers rather than silently converting predictions into facts.
- [ ] **Step 6: Re-run the focused tests and confirm GREEN.**
- [ ] **Step 7: Commit Task 4.**

```bash
git add packages/goal/tool-goal
git commit -m "feat(goal): gate completion on quality foresight evidence"
```

### Task 5: Base-profile composition and real runnable snapshot

**Files:**
- Modify: `packages/bundle/base/cordis.patch.yml`
- Modify: `packages/bundle/base/package.json`
- Modify: `packages/bundle/base/tests/base.spec.ts`
- Modify: `apps/cli/config/agent-presets/standard/agent.cordis.yml`
- Modify: `apps/cli/config/agent-presets/code/agent.cordis.yml`
- Add or modify: `examples/acp-agent/tests/goal-snapshots/quality-foresight/*`
- Modify: `examples/acp-agent/tests/goal.snapshot.ts`

**Interfaces:**
- Normal Phoenix profiles mount `quality-session` before `tool-quality`/`tool-goal`.
- Keyless snapshot demonstrates: substantial goal → quality assessment → failed adversarial scenario/open forecast → `needs_changes` → repaired evidence → innovation disposition → independent PASS → goal completion.

- [ ] **Step 1: Write the failing base-bundle test asserting all three quality packages are mounted in dependency order.**
- [ ] **Step 2: Run `pnpm exec vitest run packages/bundle/base/tests/base.spec.ts` and confirm RED.**
- [ ] **Step 3: Mount the packages and dependencies in the base bundle and presets.**
- [ ] **Step 4: Run the base test and confirm GREEN.**
- [ ] **Step 5: Record/add a keyless runnable snapshot whose expected transcript contains a `needs_changes` repair cycle before final completion.**
- [ ] **Step 6: Run the targeted snapshot command used by `examples/acp-agent/tests/goal.snapshot.ts` and confirm GREEN.**
- [ ] **Step 7: Commit Task 5.**

```bash
git add packages/bundle/base apps/cli/config/agent-presets examples/acp-agent/tests
git commit -m "feat(bundle): mount quality foresight runtime"
```

### Task 6: Documentation, subsystem surface, and architectural note

**Files:**
- Create: `packages/quality/README.md`
- Create: `docs/subsystems/quality.md`
- Create: `.agents/notes/implemented/architecture/2026-09-15-quality-foresight-completion-runtime.md`
- Modify: `packages/README.md`
- Modify: `docs/architecture.md`
- Regenerate: `docs/config-catalog.md`, `docs/tool-catalog.md`, `docs/event-producer-consumer.md`, `docs/module-graph.md`, and other generated surfaces changed by the normal generators.

**Interfaces:**
- Documentation names `ctx.quality` as the owner of evidence-backed completion readiness and links to `ctx.goals` and `ctx.living` rather than duplicating their responsibilities.

- [ ] **Step 1: Add docs that describe current runtime behavior, not implementation history.**
- [ ] **Step 2: Run catalog/doc generators required by the repository and keep generated sources fresh.**
- [ ] **Step 3: Run `pnpm run doc-sync` and fix every failure.**
- [ ] **Step 4: Commit Task 6.**

```bash
git add packages/README.md packages/quality docs .agents/notes
git commit -m "docs: document quality foresight capability"
```

### Task 7: Focused integration verification and promotion

**Files:**
- No new behavior files unless a verification failure exposes a real defect; any fix begins with a failing regression test.

**Interfaces:**
- Produces one verified feature commit stack that can fast-forward `main`, then `stable` to the exact same head.

- [ ] **Step 1: Run focused unit/integration tests for all changed packages.**

```bash
pnpm exec vitest run \
  packages/quality/quality/tests \
  packages/quality/quality-session/tests \
  packages/quality/tool-quality/tests \
  packages/goal/tool-goal/tests/completion-gate.spec.ts \
  packages/goal/tool-goal/tests/judge.spec.ts \
  packages/bundle/base/tests/base.spec.ts
```

Expected: exit 0, zero failed tests.

- [ ] **Step 2: Run package type/build verification for the changed source surfaces.**

```bash
pnpm run typecheck
pnpm run build
```

Expected: both exit 0.

- [ ] **Step 3: Run `pnpm run doc-sync`.**
Expected: exit 0.

- [ ] **Step 4: Inspect `git diff --check` and the branch diff against its base.**
Expected: no whitespace errors, no unrelated files, no secrets, no generated residue.

- [ ] **Step 5: Push/open the implementation PR and require CI to report success for the feature head.**
- [ ] **Step 6: After fresh CI evidence is green, fast-forward `main` to the verified feature head.**
- [ ] **Step 7: Re-check `main` status at that exact SHA; then fast-forward `stable` to the same SHA.**
- [ ] **Step 8: Compare `stable...main`; expected `identical`, and report the exact shared commit SHA plus verification evidence.**
