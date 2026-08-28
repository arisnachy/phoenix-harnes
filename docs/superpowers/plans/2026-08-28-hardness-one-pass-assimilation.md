# HARDNESS One-Pass Assimilation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the vertical path from cataloged capability to governed execution, evidence-backed verification, and rich UI in one mission pass.

**Architecture:** Extend the existing HARDNESS adapter layer rather than creating a second control plane. The production composition will explicitly wire OpenClaw acquisition/execution, enrich capability descriptors conservatively, normalize successful results into artifacts, and keep promotion/quarantine evidence-bound.

**Tech Stack:** TypeScript 6, Vitest, Cordis, HARDNESS, PHOENIX tools/skills, OpenClaw compatibility runtime.

**Spec:** `docs/superpowers/specs/2026-08-28-hardness-one-pass-assimilation-design.md`

## Global Constraints

- Work only on `feat/hardness-one-pass-assimilation` until final verified integration.
- Do not weaken HARDNESS verification or execute catalog-only capabilities.
- Do not bypass PHOENIX approval or expose credentials.
- Do not add donor catalogs or unrelated features.
- All production behavior changes are test-first.
- `main` and `stable` move only after the exact candidate head is verified.

---

### Task 1: One-pass orchestration regression

**Files:**
- Modify: `packages/hardness/adapters/tests/mission-orchestrator.spec.ts`
- Modify: `packages/hardness/adapters/src/mission-orchestrator.ts`

**Interfaces:**
- Consumes: `HardnessService.route`, `AcquisitionRegistry.acquireOrBuild`, `executeCapabilityNeed`.
- Produces: one mission invocation that acquires once, resumes routing, executes, renders, records evidence, and promotes/quarantines.

- [ ] Add a failing test proving an initially unroutable capability is acquired and completed in the same `runHardnessMission` call.
- [ ] Run `pnpm exec vitest run packages/hardness/adapters/tests/mission-orchestrator.spec.ts` and confirm RED for the new behavior.
- [ ] Implement the smallest orchestration change needed.
- [ ] Re-run the focused test and confirm GREEN.

### Task 2: Result normalization to rich artifact

**Files:**
- Modify: `packages/hardness/adapters/tests/artifact-runtime.spec.ts`
- Modify: `packages/hardness/adapters/src/artifact-runtime.ts`
- Modify: `packages/hardness/adapters/src/mission-orchestrator.ts`

**Interfaces:**
- Produces: `artifactFromCapabilityResult(result, fallbackId)` that preserves explicit `meta.artifact` and safely normalizes ordinary successful structured/text output.

- [ ] Add RED cases for JSON/text results without `meta.artifact`.
- [ ] Implement conservative normalization with no HTML invention and no external action authority.
- [ ] Confirm artifact-runtime and mission-orchestrator tests GREEN.

### Task 3: Descriptor enrichment

**Files:**
- Modify: `packages/hardness/adapters/tests/adapters.spec.ts`
- Modify: `packages/hardness/adapters/src/tool-adapter.ts`
- Modify: `packages/hardness/adapters/src/skill-adapter.ts`

**Interfaces:**
- Produces: descriptors whose inputs/outputs/compatibility/limitations reflect discoverable registry metadata instead of unconditional empty arrays.

- [ ] Add RED assertions for tool schema input/output hints and skill provenance/compatibility hints.
- [ ] Implement conservative extraction only from metadata already exposed by the registries.
- [ ] Keep status `experimental`; verification remains evidence-driven.
- [ ] Confirm adapter tests GREEN.

### Task 4: OpenClaw production wiring

**Files:**
- Modify: `packages/hardness/adapters/tests/mission-runtime.spec.ts`
- Modify: `packages/hardness/adapters/tests/openclaw-broker.spec.ts`
- Modify: `packages/hardness/adapters/src/index.ts`
- Modify/Create only if existing seams require it: `packages/hardness/adapters/src/openclaw/*`

**Interfaces:**
- Consumes: `OpenClawCapabilityBroker.acquire/execute`.
- Produces: explicit broker passed into `createHardnessAcquisition(...)` and executor passed into `installHardnessMissionRuntime(...)`.

- [ ] Add a RED production-composition test proving OpenClaw is not merely indexed but supplied to acquisition/execution.
- [ ] Reuse the existing broker/host seams; do not create a second control plane.
- [ ] If no safe concrete installer exists, fail closed with an explicit preparation diagnostic rather than pretending the catalog is executable.
- [ ] Confirm mission-runtime/OpenClaw focused tests GREEN.

### Task 5: Evidence, version invalidation, and quarantine

**Files:**
- Modify: `packages/hardness/adapters/tests/mission-orchestrator.spec.ts`
- Modify only as needed: `packages/hardness/adapters/src/mission-orchestrator.ts`

**Interfaces:**
- Evidence descriptor version must match the routed surface version.
- Renderer failure and deterministic execution failure quarantine the exact capability version.

- [ ] Add RED cases for renderer failure, execution failure, and version-bound evidence.
- [ ] Implement minimal corrections.
- [ ] Confirm GREEN.

### Task 6: Regression gates and integration

**Files:** no production changes unless a gate reveals a concrete regression.

- [ ] Run focused HARDNESS adapter suite: `pnpm exec vitest run packages/hardness/adapters/tests`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm build`.
- [ ] Run repository CI gates available on the PR.
- [ ] Compare branch against latest `main`; rebase/merge latest `main` into the feature branch without overwriting concurrent work.
- [ ] Re-run focused tests/typecheck/build on the exact post-integration head.
- [ ] Merge the verified PR into `main` only if the exact head passes.
- [ ] Re-verify `main` head status.
- [ ] Fast-forward `stable` to the verified `main` SHA only after `main` verification.
