# HARDNESS Declarative Capability Router Implementation Plan

English | [中文](2026-08-27-hardness-capability-router.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provider-neutral router that selects a verified capability and requested modality without executing tools or granting permissions.

**Architecture:** Extend `@phoenix-ai/dsh-hardness` with explicit modality metadata and a `CapabilityRouter` consumer. The router delegates capability matching to `HardnessService.resolveNeed`, applies modality preferences deterministically, and returns `route`, `missing`, or `unknown`. Existing tools, skills, sandbox, Permission Broker, visual runtime, workspace, and acquisition remain independent authorities.

**Tech Stack:** TypeScript strict mode, Cordis `Service`, Vitest, oxlint, existing HARDNESS package and Host aggregate.

---

### Task 1: Add modality-aware route contracts

**Files:**
- Modify: `packages/hardness/hardness/src/types.ts`
- Test: `packages/hardness/hardness/tests/router.spec.ts`

- [ ] **Step 1: Write failing contract tests**

Add tests that construct a verified descriptor with `modalities: ['native', 'visual']` and assert a requested `visual` route returns the capability, modality, required permissions, and original need. Add assertions that a request for `workspace` returns `missing`, an unknown kind returns `unknown`, and no result includes an execution callback.

```ts ignore-check
expect(result).toMatchObject({ kind: 'route', route: { modality: 'visual', capability: { id } } })
expect(result.kind).toBe('missing')
expect(result.kind).toBe('unknown')
expect('execute' in result).toBe(false)
```

- [ ] **Step 2: Run the focused test and verify red**

Run `pnpm exec vitest run packages/hardness/hardness/tests/router.spec.ts`.

Expected: FAIL because `CapabilityDescriptor` has no modalities and no router result contract.

- [ ] **Step 3: Define public route types**

Add extensible `CapabilityModality`, initial modality literals, `CapabilityRoute`, `CapabilityRouteResult`, and `CapabilityRouteOptions`. Add `modalities: readonly CapabilityModality[]` to `CapabilityDescriptor`. Add `route(need, options?)` to `HardnessService`.

`CapabilityRouteResult` must discriminate as:

```ts ignore-check
type CapabilityRouteResult =
  | { readonly kind: 'route'; readonly route: CapabilityRoute }
  | { readonly kind: 'missing'; readonly considered: readonly string[]; readonly reasons: readonly string[] }
  | { readonly kind: 'unknown'; readonly considered: readonly string[]; readonly reasons: readonly string[] }
```

- [ ] **Step 4: Update every existing descriptor fixture with `modalities: ['native']`**

Keep the field required and explicit; do not infer a modality from capability kind.

- [ ] **Step 5: Run the focused tests and typecheck**

Run `pnpm exec vitest run packages/hardness/hardness/tests/router.spec.ts packages/hardness/hardness/tests/service.spec.ts packages/hardness/hardness/tests/registry.spec.ts packages/hardness/hardness/tests/resolver.spec.ts packages/hardness/hardness/tests/evidence.spec.ts packages/hardness/hardness/tests/unknown-need.e2e.spec.ts` and `pnpm exec tsc -b packages/hardness/hardness --pretty false`.

Expected: typecheck succeeds; router tests still fail until Task 2 supplies the implementation.

- [ ] **Step 6: Commit contracts**

```sh
git add packages/hardness/hardness/src/types.ts packages/hardness/hardness/tests
 git commit -m "feat: add HARDNESS capability modality contracts"
```

### Task 2: Implement deterministic declarative routing

**Files:**
- Create: `packages/hardness/hardness/src/capability-router.ts`
- Modify: `packages/hardness/hardness/src/index.ts`
- Test: `packages/hardness/hardness/tests/router.spec.ts`

- [ ] **Step 1: Add preference and mismatch tests**

Cover preferred modality order, capability version tie-breaking, incompatible modalities, missing permissions, and preservation of resolver reasons. A route is valid only when the delegated resolution is `have` and the selected descriptor contains the requested modality.

- [ ] **Step 2: Run router tests and verify red**

Run `pnpm exec vitest run packages/hardness/hardness/tests/router.spec.ts`.

Expected: FAIL because `route` is not implemented.

- [ ] **Step 3: Implement `routeCapabilityNeed`**

Call `hardness.resolveNeed(need, { permissions: options.permissions })`. If the result is `unknown` or `missing`, copy its kind, considered ids, and reasons unchanged. For `have`, compute the intersection between descriptor modalities and `options.modalities ?? ['native']`; if empty, return `missing` with a modality reason. Select the first option according to requested preference order, copy `requiredPermissions`, and never attach executable values.

Use stable sorting for competing descriptors: modality preference index, descriptor version descending through `compareCapabilityVersions`, then id ascending. Keep this function pure except for the service read.

- [ ] **Step 4: Expose `CapabilityRouter` through HARDNESS**

Construct the router from the registry service in `HardnessRegistry`, return it from `service.router`, and implement `service.route` as a delegating method. Preserve the existing `resolveNeed` API and disposal behavior.

- [ ] **Step 5: Run router suite and lint**

Run `pnpm exec vitest run packages/hardness/hardness/tests/router.spec.ts` and `pnpm exec tsx scripts/run-oxlint.ts packages/hardness/hardness`.

Expected: router tests pass and oxlint reports 0 warnings and 0 errors.

- [ ] **Step 6: Commit routing**

```sh
git add packages/hardness/hardness/src packages/hardness/hardness/tests
 git commit -m "feat: route HARDNESS needs by capability modality"
```

### Task 3: Verify real composition and adapter metadata

**Files:**
- Modify: `packages/hardness/hardness/tests/loader-composition.spec.ts`
- Modify: `packages/hardness/adapters/src/tool-adapter.ts`
- Modify: `packages/hardness/adapters/src/skill-adapter.ts`
- Modify: `packages/hardness/adapters/tests/adapters.spec.ts`
- Modify: `packages/bundle/base/cordis.patch.yml`

- [ ] **Step 1: Add modality assertions to adapter tests**

Assert tool and skill projections explicitly contain `modalities: ['native']`, and route a projected descriptor through the public service route method. Assert disposal removes all owned descriptors.

- [ ] **Step 2: Extend the Loader composition test**

Load the HARDNESS service and adapters through the existing base composition fixture, assert the route method is available, and dispose the composed fiber. Do not add the JSON provider to defaults; its path remains deployment configuration.

- [ ] **Step 3: Run composition and adapter tests**

Run `pnpm exec vitest run packages/hardness packages/bundle/base/tests/base.spec.ts`.

Expected: all HARDNESS and base composition tests pass. The known Google authorization fixture mismatch must remain separately reported if it reproduces.

- [ ] **Step 4: Commit composition verification**

```sh
git add packages/hardness packages/bundle/base/cordis.patch.yml
 git commit -m "test: verify HARDNESS routing in composition"
```

### Task 4: Documentation and repository gates

**Files:**
- Modify: `packages/hardness/hardness/README.md`
- Modify: `packages/hardness/hardness/README.zh.md`
- Modify: `packages/hardness/hardness/README.i18n.yaml`
- Modify: `docs/architecture.md`
- Modify: `docs/architecture.zh.md`
- Modify: `docs/event-producer-consumer.md`
- Modify: `docs/event-producer-consumer.i18n.yaml`
- Modify: `tsconfig.host.json`

- [ ] **Step 1: Document route semantics**

Document the modalities, preference order, honest result kinds, and explicit non-authority boundary. Link the router spec and preserve language switchers.

- [ ] **Step 2: Regenerate graph documentation and translation records**

Run `pnpm run gen-doc-graphs` followed by `pnpm run verify-translation-pairing --write packages/hardness/hardness/README.md docs/architecture.md docs/event-producer-consumer.md`.

- [ ] **Step 3: Run final gates**

Run:

```sh
pnpm exec vitest run packages/hardness packages/bundle/base/tests/base.spec.ts
pnpm exec tsc -b tsconfig.host.json --pretty false
pnpm exec tsx scripts/run-oxlint.ts packages/hardness packages/bundle/base
git diff --check
pnpm run verify-doc-budgets
pnpm run verify-md-links
```

Expected: focused tests, typecheck, lint, format, budgets, and links pass. Record any pre-existing corpus-wide translation failures without attributing them to the router.

- [ ] **Step 4: Commit documentation and gates**

```sh
git add docs packages/hardness tsconfig.host.json
 git commit -m "docs: document HARDNESS declarative routing"
```

## Self-review checklist

- Unknown and missing results remain honest: Tasks 1–2.
- Verified capability and modality selection is deterministic: Task 2.
- Permissions are declarations only: Tasks 1–2.
- Existing registries remain execution authorities: Task 3.
- Cordis composition and disposal are covered: Task 3.
- Documentation and repository gates are covered: Task 4.
- Visual execution, generative UI, workspace mutation, acquisition, and automatic promotion remain deferred as required by the spec.
