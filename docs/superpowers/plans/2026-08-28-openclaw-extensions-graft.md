# OpenClaw Extensions Graft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the complete pinned OpenClaw `extensions/` catalog discoverable in Phoenix and activate compatible extensions through a Phoenix-owned compatibility runtime without replacing Phoenix security or control-plane contracts.

**Architecture:** Add `packages/extensions/openclaw-compat` as a metadata-first adapter. It translates OpenClaw manifests into Phoenix descriptors, publishes a pinned donor catalog for ATLAS/HARDNESS, and exposes capability-gated activation hooks that remain subordinate to Phoenix credentials, guard/approval, sandbox, jobs, and Cordis runtime.

**Tech Stack:** TypeScript 6, Vitest, pnpm 11, existing Phoenix Cordis/HARDNESS contracts.

**Spec:** `docs/superpowers/specs/2026-08-28-openclaw-extensions-graft-design.md`

## Global Constraints

- OpenClaw donor is pinned to commit `515c3d8ff3fce77838d69d1da838ad691c18d755`.
- Phoenix remains the only canonical control plane.
- Catalog discovery is metadata-only and must not execute extension runtime code.
- Sensitive values are never copied into descriptors or model-visible metadata.
- Incompatible or unavailable extensions fail locally with diagnostics and never crash Phoenix startup.
- Promotion to `main` requires exact-head CI green.

---

### Task 1: Manifest translator and diagnostics

**Files:**
- Create: `packages/extensions/openclaw-compat/tests/manifest.spec.ts`
- Create: `packages/extensions/openclaw-compat/src/types.ts`
- Create: `packages/extensions/openclaw-compat/src/manifest.ts`
- Create: `packages/extensions/openclaw-compat/src/index.ts`
- Create: `packages/extensions/openclaw-compat/package.json`
- Create: `packages/extensions/openclaw-compat/tsconfig.json`

**Interfaces:**
- Produces: `translateOpenClawManifest(manifest: unknown): PhoenixExtensionDescriptor`
- Produces: `validateOpenClawExtension(descriptor, environment?): CompatibilityReport`

- [ ] Write failing tests proving identity/config/tool/channel/dashboard/secret-provider translation, preservation of unknown fields under namespaced metadata, redaction of sensitive values, and explicit compatibility states.
- [ ] Run the PR CI and confirm the tests fail because the production module does not exist.
- [ ] Implement the minimal types and translator to satisfy tests.
- [ ] Re-run focused tests and typecheck through CI.
- [ ] Commit.

### Task 2: Complete pinned donor catalog

**Files:**
- Create: `packages/extensions/openclaw-compat/tests/catalog.spec.ts`
- Create: `packages/extensions/openclaw-compat/src/catalog.ts`
- Create: `packages/extensions/openclaw-compat/src/catalog.generated.ts`

**Interfaces:**
- Produces: `OPENCLAW_DONOR_COMMIT`
- Produces: `OPENCLAW_EXTENSION_IDS`
- Produces: `listOpenClawExtensions(): OpenClawExtensionDescriptor[]`

- [ ] Write failing tests requiring deterministic ordering, unique ids, representative family coverage, the pinned donor SHA, and a catalog size floor that prevents silent truncation.
- [ ] Confirm RED in CI.
- [ ] Add the generated metadata-only catalog for every extension directory in the pinned donor tree.
- [ ] Re-run tests and typecheck.
- [ ] Commit.

### Task 3: Capability publication and activation boundary

**Files:**
- Create: `packages/extensions/openclaw-compat/tests/runtime.spec.ts`
- Create: `packages/extensions/openclaw-compat/src/runtime.ts`
- Create: `packages/extensions/openclaw-compat/src/capabilities.ts`

**Interfaces:**
- Produces: `toPhoenixCapabilities(descriptor): PhoenixOpenClawCapability[]`
- Produces: `createOpenClawCompatibilityRuntime(options): OpenClawCompatibilityRuntime`
- Runtime supports `discover`, `status`, `activate`, and `deactivate` with injected Phoenix-owned activation/deactivation functions.

- [ ] Write failing tests for lazy discovery, no activation during discovery, local failure isolation, unsupported-platform diagnostics, secret-gated diagnostics, activation/deactivation bookkeeping, and representative capability mappings for A2A/device/memory/vault/browser/workboard/provider/local-model/channel families.
- [ ] Confirm RED in CI.
- [ ] Implement minimal capability mapping and runtime orchestration without importing OpenClaw core internals.
- [ ] Re-run tests and typecheck.
- [ ] Commit.

### Task 4: Workspace integration, documentation, and promotion gates

**Files:**
- Modify: `tsconfig.host.json`
- Modify: `packages/extensions/README.md`
- Create: `packages/extensions/openclaw-compat/README.md`

**Interfaces:**
- Host aggregate references the new package.
- Extension README documents OpenClaw compatibility boundary and safety model.

- [ ] Add the package reference to the host aggregate.
- [ ] Document donor pin, metadata-only discovery, lazy activation, diagnostics, and update workflow.
- [ ] Run PR CI and inspect exact-head failures.
- [ ] Fix only failures caused by this graft.
- [ ] Mark PR ready when exact head is green.
- [ ] Merge PR to `main` using expected head SHA.
- [ ] Verify `main` points at the merged commit and do not modify `stable` in this mission.
