# Living Observation + Verified Outcome Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the approved Quality/Foresight architecture by validating claimed live evidence against `ctx.living` and promoting only independently accepted, evidence-backed forecast outcomes into PHOENIX learning memory.

**Architecture:** Keep `ctx.living` as the only operational authority for created systems and `ctx.goals` as the only completion/repair loop. The adversarial completion gate may request read-only living tools, but programmatic validation re-checks every `live` authority reference through `LivingRegistry.inspect/readState` before the evidence is trusted. After a quality-ready independent PASS, `tool-goal` may promote only `confirmed` or `contradicted` forecasts with concrete evidence into `learningMemory`; open/mitigated/accepted/unknown forecasts remain hypotheses and are never promoted automatically.

**Tech Stack:** TypeScript ESM, Cordis Services, `@phoenix-ai/dsh-living`, `@phoenix-ai/dsh-quality`, `@phoenix-ai/dsh-session-learning`, existing goal adversarial gate/judge, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-quality-foresight-living-systems-design.md`

## Global Constraints

- Do not create a second connector or control plane; all runtime authority comes from `ctx.living`.
- Do not create a second autonomous loop; failed live verification remains a goal quality blocker and the existing goal driver repairs/retries.
- A string claiming `live` is not evidence. The referenced living creation must exist, be connected when its target is above `static`, achieve its declared target level, and expose readable authoritative state when state is declared.
- Live validation is read-only. It must never call living actions merely to increase coverage.
- A forecast is never learned automatically while `open`, `mitigated`, `accepted`, or `unknown`.
- Automatic learning requires an independent goal judge `pass` for the exact objective/revision plus non-empty evidence on a `confirmed` or `contradicted` forecast.
- Learning writes are redacted by the existing `LearningMemoryService`; no raw state payload or secrets are copied into memory.
- TDD remains mandatory for behavior changes.

---

### Task 1: Living evidence is programmatically authoritative

**Files:**
- Modify: `packages/goal/tool-goal/src/completion-gate.ts`
- Modify: `packages/goal/tool-goal/src/judge.ts`
- Modify: `packages/goal/tool-goal/src/index.ts`
- Modify: `packages/goal/tool-goal/package.json`
- Test: `packages/goal/tool-goal/tests/living-quality-evidence.spec.ts`

**Interfaces:**
- `runAdversarialCompletionGate(...)` accepts optional `living: Pick<LivingRegistry, 'inspect' | 'readState'>`.
- A live scenario authority uses `living:<creation-id>`.
- Programmatic validation downgrades/blocks a live PASS when the authority ref is malformed, unknown, offline below a non-static target, below target integration level, or cannot read its declared state.
- `judgeGoalCompletion(...)` receives and forwards optional living authority.
- `update_goal complete` obtains `ctx.get('living', false)` and passes it to the judge.

- [ ] **Step 1: Write failing tests** proving a fabricated `living:unknown` live PASS is rejected, an offline connected target is rejected, and a connected provider at/above target with readable state remains live PASS.
- [ ] **Step 2: Run the focused test and confirm RED** because current parser trusts any non-empty `authority_ref`.
- [ ] **Step 3: Add read-only living tools to the independent tester allow-list** (`living_inspect_creation`, `living_read_state`, `living_verify_creation`) and instruct the tester to use `living:<id>` only after authoritative verification.
- [ ] **Step 4: Implement programmatic living validation** after structured parsing; never call `act()`.
- [ ] **Step 5: Forward optional `living` from `update_goal` through the judge/gate.**
- [ ] **Step 6: Re-run focused goal tests and confirm GREEN.**
- [ ] **Step 7: Commit** `feat(quality): verify live evidence through living registry`.

### Task 2: Living assessments require genuine live evidence

**Files:**
- Modify: `packages/quality/quality/src/readiness.ts`
- Modify: `packages/goal/tool-goal/src/judge.ts`
- Test: `packages/quality/quality/tests/readiness.spec.ts`
- Test: `packages/goal/tool-goal/tests/living-quality-evidence.spec.ts`

**Interfaces:**
- `qualityReadiness()` for `taskClass: 'living'` requires at least one material scenario with `evidenceKind: 'live'`, `status: 'pass'`, and a `living:` authority ref.
- Auto-created judge assessments use `living` task class when the independently validated gate contains a living authority reference; otherwise they remain `substantial`.

- [ ] **Step 1: Add failing readiness tests** for living-without-live-evidence and living-with-validated-live-evidence.
- [ ] **Step 2: Confirm RED.**
- [ ] **Step 3: Implement the minimum readiness rule and task-class selection.**
- [ ] **Step 4: Confirm GREEN and run all quality readiness tests.**
- [ ] **Step 5: Commit** `feat(quality): require live evidence for living missions`.

### Task 3: Promote only independently verified outcomes to learning

**Files:**
- Create: `packages/goal/tool-goal/src/quality-learning.ts`
- Modify: `packages/goal/tool-goal/src/index.ts`
- Modify: `packages/goal/tool-goal/package.json`
- Test: `packages/goal/tool-goal/tests/quality-learning.spec.ts`

**Interfaces:**
- `promoteVerifiedQualityOutcomes({ learningMemory, agent, assessment, judge })` returns the count promoted.
- It is a no-op unless judge verdict is `pass` and `qualityReadiness(assessment).ready` is true.
- Only forecasts with status `confirmed` or `contradicted` and non-empty evidence become cognitive `lesson` records.
- Each record uses source type `quality/verified-outcome:<forecast-id>`, current session id/seq, semantic+procedural+temporal layers, bounded summary text, confidence derived from forecast confidence, and importance derived from impact.
- No raw living state payload is persisted; only scenario, disposition, and bounded evidence references are included.

- [ ] **Step 1: Write failing tests** proving open/mitigated forecasts are not learned, confirmed/contradicted with evidence are learned after PASS, and `needs_changes` never promotes.
- [ ] **Step 2: Confirm RED.**
- [ ] **Step 3: Implement the pure eligibility mapping and async promotion helper.**
- [ ] **Step 4: In `update_goal complete`, after `recordGoalJudge` and before durable completion, call the helper only when judge PASS and both `quality` and `learningMemory` are mounted.**
- [ ] **Step 5: Confirm GREEN and run goal wiring/judge regressions.**
- [ ] **Step 6: Commit** `feat(quality): learn only verified forecast outcomes`.

### Task 4: Integrated proof and documentation

**Files:**
- Add/modify focused integration fixture under `packages/goal/tool-goal/tests/` or `examples/acp-agent/tests/goal-snapshots/quality-foresight/` depending on which existing keyless harness can express the structured judge flow without network access.
- Create/update: `docs/subsystems/quality.md`
- Create/update: `packages/quality/README.md`
- Create: `.agents/notes/implemented/architecture/2026-09-15-quality-foresight-completion-runtime.md`
- Modify generated catalogs after `pnpm run prepare:change`.

- [ ] **Step 1: Add a keyless proof** showing one mission blocked by a material forecast/live verification issue, repaired, then independently passed; confirm the quality event history remains replayable.
- [ ] **Step 2: Add a verified-learning assertion** proving the accepted forecast outcome is discoverable in cognitive memory while an unconfirmed forecast is not promoted as a lesson.
- [ ] **Step 3: Document authority boundaries and user-visible behavior.**
- [ ] **Step 4: Run `pnpm run prepare:change`, `pnpm run doc-sync`, focused Vitest, package typechecks, and relevant CI gates.**
- [ ] **Step 5: Remove all temporary quality TDD workflows before final verification.**
- [ ] **Step 6: Final fresh verification on the cleaned feature head, then fast-forward `main` and `stable` to the same verified SHA only if both updates are non-forced fast-forwards.**
