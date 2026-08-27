# HARDNESS Core + Tool Atlas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `codex-superpowers-subagent-driven-development` or `codex-superpowers-executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build a provider-neutral HARDNESS capability registry, resolver, evidence lifecycle, and durable Tool Atlas that can be consumed by later router and visual-runtime phases.

**Architecture:** Add `@deepseek-ai/dsh-hardness` as the typed service definition, in-memory provider, lifecycle/evidence engine, and NEED resolver. Add `@deepseek-ai/dsh-hardness-atlas-json` as the host-side durable JSON provider behind a narrow persistence interface. Existing tools and skills publish descriptors through adapters; the atlas never replaces their registries or grants permissions.

**Tech Stack:** TypeScript strict mode, Cordis plugins/effects, Zod/Schemastery validation, Vitest, existing PHOENIX package/build gates, atomic local JSON persistence.

---

### Task 1: Create the hardness package seams

**Files:**
- Create: `packages/hardness/hardness/package.json`
- Create: `packages/hardness/hardness/tsconfig.json`
- Create: `packages/hardness/hardness/README.md`
- Create: `packages/hardness/hardness/src/types.ts`
- Create: `packages/hardness/hardness/src/index.ts`
- Create: `packages/hardness/hardness/src/invariant.ts`
- Test: `packages/hardness/hardness/tests/service.spec.ts`
- Test: `packages/hardness/hardness/tests/composition.e2e.ts`

- [ ] **Step 1: Add the package metadata and TypeScript project reference**

Use the existing package conventions from `packages/core/tools/package.json`: package name `@deepseek-ai/dsh-hardness`, ESM exports for `.`, `./types`, and `./src/*`, peer dependency on `@deepseek-ai/cordis`, and dev dependency on `@deepseek-ai/cordis`.

Set `rootDir` to `src`, `outDir` to `lib/types`, and reference the vendored Cordis project exactly as the nearest core package does.

- [ ] **Step 2: Write the failing service contract test**

Create a Cordis context, mount the HARDNESS plugin, and assert that `ctx.hardness` exists, starts with an empty atlas, and exposes `register`, `get`, `list`, and `resolveNeed`. The test must also assert that the plugin disposer removes the service.

```ts
it('mounts an empty provider-neutral capability service', async () => {
  const ctx = new Context()
  const dispose = await ctx.plugin(Hardness)
  expect(ctx.hardness.list()).toEqual([])
  expect(typeof ctx.hardness.register).toBe('function')
  expect(typeof ctx.hardness.resolveNeed).toBe('function')
  dispose()
  expect(ctx.get('hardness')).toBeUndefined()
  await ctx.fiber.dispose()
})
```

- [ ] **Step 3: Run the focused test and verify the expected red failure**

Run `pnpm exec vitest run packages/hardness/hardness/tests/service.spec.ts`.

Expected result: FAIL because the package and `Hardness` service do not exist.

- [ ] **Step 4: Define the public types and Cordis service**

In `src/types.ts`, define branded `CapabilityId`, extensible string `CapabilityKind`, `CapabilityStatus`, `CapabilityPermission`, `CapabilityDescriptor`, `CapabilityEvidence`, `CapabilityNeed`, `CapabilityResolution`, `CapabilityRegistration`, and `HardnessService`. Keep permissions required-only; do not expose credential payloads. Use discriminated result kinds `have`, `missing`, and `unknown`.

In `src/index.ts`, declare `Context.hardness`, export the public types, default-export the service class, and register the empty provider through a reversible Cordis effect. Add the package-owned `src/invariant.ts` and register the manifest name with a meaningful runtime relation check (or a package-specific documented no-runtime-invariant reason).

- [ ] **Step 5: Add the REAL-composition regression test**

Boot a test-only `cordis.yml` through the Loader and app/process path used by existing package composition tests. Assert the mounted service can register a descriptor and that its durable/model-visible result is available through the composed context. Dispose the fiber and assert the registration is removed, proving HMR-safe cleanup rather than only testing a hand-built context.

- [ ] **Step 6: Run the focused tests and verify green**

Run `pnpm exec vitest run packages/hardness/hardness/tests/service.spec.ts packages/hardness/hardness/tests/composition.e2e.ts`.

Expected result: PASS.

- [ ] **Step 7: Commit the seam**

```sh
git add packages/hardness/hardness
git commit -m "feat: add HARDNESS capability service seam"
```

### Task 2: Implement registry validation and lifecycle

**Files:**
- Create: `packages/hardness/hardness/src/registry.ts`
- Modify: `packages/hardness/hardness/src/index.ts`
- Test: `packages/hardness/hardness/tests/registry.spec.ts`

- [ ] **Step 1: Write tests for registration and invalid transitions**

Cover valid registration, same-id replacement with a newer version, disposer-based removal, invalid descriptor rejection without mutation, promotion refusal without successful evidence, and valid transitions through `experimental`, `testing`, `verified`, `broken`, `quarantined`, and `deprecated`.

Use assertions such as:

```ts
expect(() => service.register(invalidDescriptor)).toThrow(/descriptor/i)
expect(service.list()).toHaveLength(0)
expect(() => service.transition(id, 'verified', 'manual')).toThrow(/evidence/i)
```

- [ ] **Step 2: Run the registry tests and verify red**

Run `pnpm exec vitest run packages/hardness/hardness/tests/registry.spec.ts`.

Expected result: FAIL because registry operations are not implemented.

- [ ] **Step 3: Implement the smallest registry**

Store descriptors in a `Map<CapabilityId, StoredCapability>`. Validate descriptor shape at the persistence/model boundary with Zod. Require monotonically increasing descriptor versions for replacement. Return a disposer that removes only the exact registered version. Keep transition history in the stored record and require a matching successful evidence id for `verified`.

Reject `verified → experimental` and any transition that loses the current descriptor without a replacement. Do not mutate the map when validation or transition checks fail.

- [ ] **Step 4: Run registry tests and verify green**

Run `pnpm exec vitest run packages/hardness/hardness/tests/registry.spec.ts`.

Expected result: PASS.

- [ ] **Step 5: Commit lifecycle behavior**

```sh
git add packages/hardness/hardness/src packages/hardness/hardness/tests/registry.spec.ts
git commit -m "feat: add HARDNESS capability lifecycle"
```

### Task 3: Implement deterministic NEED resolution

**Files:**
- Create: `packages/hardness/hardness/src/resolver.ts`
- Modify: `packages/hardness/hardness/src/registry.ts`
- Test: `packages/hardness/hardness/tests/resolver.spec.ts`

- [ ] **Step 1: Write resolver tests**

Register descriptors for a verified filesystem reader, an experimental renderer, a capability with an unsatisfied permission, and a capability with a missing dependency. Assert:

- compatible verified descriptor returns `have`;
- known need without a usable descriptor returns `missing` and names the absent dependency/permission;
- unsupported `kind` or unknown format returns `unknown`;
- quarantined and deprecated descriptors cannot satisfy a verified need;
- equal candidates are selected by stable id and version, not map insertion order.

- [ ] **Step 2: Run resolver tests and verify red**

Run `pnpm exec vitest run packages/hardness/hardness/tests/resolver.spec.ts`.

Expected result: FAIL because `resolveNeed` has no matching implementation.

- [ ] **Step 3: Implement `resolveNeed`**

Normalize only declared need fields. Filter candidates by kind, input/output compatibility, required status, dependencies, and permission context. Return all considered candidate ids plus a concrete reason for each rejection. Sort candidates by status rank, version descending, and id ascending. If the need cannot be classified from declared fields, return `unknown` without selecting a candidate.

- [ ] **Step 4: Run resolver tests and verify green**

Run `pnpm exec vitest run packages/hardness/hardness/tests/resolver.spec.ts`.

Expected result: PASS.

- [ ] **Step 5: Commit resolver behavior**

```sh
git add packages/hardness/hardness/src packages/hardness/hardness/tests/resolver.spec.ts
git commit -m "feat: resolve HARDNESS capability needs deterministically"
```

### Task 4: Add evidence and verification records

**Files:**
- Create: `packages/hardness/hardness/src/evidence.ts`
- Modify: `packages/hardness/hardness/src/registry.ts`
- Test: `packages/hardness/hardness/tests/evidence.spec.ts`

- [ ] **Step 1: Write evidence lifecycle tests**

Create successful, failed, permission-denied, and stale-version evidence. Assert successful evidence for the current descriptor can promote `testing` to `verified`; failed evidence preserves the prior state and records the failure; stale evidence cannot promote a replaced descriptor; a failure can move a verified descriptor to `broken` or `quarantined` only through the explicit transition operation.

- [ ] **Step 2: Run evidence tests and verify red**

Run `pnpm exec vitest run packages/hardness/hardness/tests/evidence.spec.ts`.

Expected result: FAIL because evidence storage and promotion are absent.

- [ ] **Step 3: Implement evidence storage**

Store immutable evidence records keyed by capability id and descriptor version. Strip or reject secret-like fields at the input type boundary; evidence keeps only case id, summarized input, outcome, duration, descriptor version, and artifact references. Expose `recordEvidence`, `evidenceFor`, and `promoteFromEvidence`.

- [ ] **Step 4: Run evidence tests and verify green**

Run `pnpm exec vitest run packages/hardness/hardness/tests/evidence.spec.ts`.

Expected result: PASS.

- [ ] **Step 5: Commit evidence behavior**

```sh
git add packages/hardness/hardness/src packages/hardness/hardness/tests/evidence.spec.ts
git commit -m "feat: record HARDNESS capability evidence"
```

### Task 5: Add durable JSON Tool Atlas provider

**Files:**
- Create: `packages/hardness/atlas-json/package.json`
- Create: `packages/hardness/atlas-json/tsconfig.json`
- Create: `packages/hardness/atlas-json/README.md`
- Create: `packages/hardness/atlas-json/src/index.ts`
- Create: `packages/hardness/atlas-json/src/format.ts`
- Create: `packages/hardness/atlas-json/src/invariant.ts`
- Test: `packages/hardness/atlas-json/tests/atlas-json.spec.ts`

- [ ] **Step 1: Write persistence tests**

Use a temporary directory and a real file. Register descriptors and evidence, flush, create a fresh context/provider, and reload the atlas. Assert descriptor versions, lifecycle history, and evidence survive. Interrupt a write before rename and assert the previous valid file remains readable. Write malformed JSON and assert load fails with a diagnostic error instead of returning an empty atlas.

- [ ] **Step 2: Run persistence tests and verify red**

Run `pnpm exec vitest run packages/hardness/atlas-json/tests/atlas-json.spec.ts`.

Expected result: FAIL because the provider does not exist.

- [ ] **Step 3: Implement versioned atomic JSON storage**

Define a strict top-level format with `formatVersion`, `capabilities`, `evidence`, and `updatedAt`. Validate on load and save. Write to a sibling temporary file, flush/close it, then replace the target atomically using the repository's existing Windows-safe file replacement pattern. Never treat load failure as an empty atlas.

Mount the provider as a Cordis plugin that receives its path from validated config, default-export its service class, and provide a package-owned `src/invariant.ts` with the manifest registration and a runtime persistence relation check. Keep the provider host-side and expose only the `HardnessService` interface to consumers.

- [ ] **Step 4: Run persistence tests and verify green**

Run `pnpm exec vitest run packages/hardness/atlas-json/tests/atlas-json.spec.ts`.

Expected result: PASS.

- [ ] **Step 5: Commit durable storage**

```sh
git add packages/hardness/atlas-json
git commit -m "feat: persist HARDNESS Tool Atlas atomically"
```

### Task 6: Publish descriptors from existing tools and skills

**Files:**
- Create: `packages/hardness/adapters/src/tool-adapter.ts`
- Create: `packages/hardness/adapters/src/skill-adapter.ts`
- Create: `packages/hardness/adapters/package.json`
- Create: `packages/hardness/adapters/tsconfig.json`
- Test: `packages/hardness/adapters/tests/adapters.spec.ts`
- Modify: relevant bundle composition file identified by the existing `dsh-base` plugin rows

- [ ] **Step 1: Write adapter tests against real registries**

Mount one real tool registry and one real skill registry in a Cordis fixture, mount HARDNESS, run each adapter, and assert the atlas contains descriptors whose ids, declared input/output metadata, provider location, and required permissions are derived from the source registration. Assert disposal removes only descriptors owned by that adapter.

- [ ] **Step 2: Run adapter tests and verify red**

Run `pnpm exec vitest run packages/hardness/adapters/tests/adapters.spec.ts`.

Expected result: FAIL because adapter packages and registrations do not exist.

- [ ] **Step 3: Implement adapters as reversible consumers**

Use existing registry APIs rather than duplicating tool or skill execution. Map source metadata into `CapabilityDescriptor`, mark new descriptors `experimental`, and record the source package/version. Do not infer permissions from prompt text. Register adapter effects through `ctx.effect` and return their disposers.

- [ ] **Step 4: Add the adapters to the base composition**

Mount the adapters after the source registries and before any future router. Keep the atlas persistence path configurable and separate from credentials and session logs.

- [ ] **Step 5: Run adapter tests and verify green**

Run `pnpm exec vitest run packages/hardness/adapters/tests/adapters.spec.ts`.

Expected result: PASS.

- [ ] **Step 6: Commit adapter integration**

```sh
git add packages/hardness/adapters packages/bundle/base
git commit -m "feat: index tools and skills in HARDNESS atlas"
```

### Task 7: Prove an unknown capability end-to-end

**Files:**
- Create: `packages/hardness/hardness/tests/unknown-need.e2e.spec.ts`
- Create: `.kira/labs/phoenix-hardness/README.md`
- Create: `.kira/labs/phoenix-hardness/experiments.md`
- Create: `.kira/labs/phoenix-hardness/learning-memory.md`
- Modify: `.kira/evidence.md`

- [ ] **Step 1: Choose and encode an unlisted need**

Use a need not named in the mission examples, such as `calendar_invite` with an `.ics` output artifact. The test must start from the need declaration, not from a preselected renderer or tool id.

- [ ] **Step 2: Run the end-to-end test and verify the honest unknown result**

Run `pnpm exec vitest run packages/hardness/hardness/tests/unknown-need.e2e.spec.ts`.

Expected result before adding the fixture capability: `unknown` or `missing` with a concrete explanation, never `have`.

- [ ] **Step 3: Register a minimal fixture capability through the public adapter path**

Register a deterministic local `.ics` generator descriptor with required permissions empty, execute its verification case, promote it to `verified`, and resolve the original need again. Assert the final result is `have`, includes the descriptor id, and carries the evidence reference.

- [ ] **Step 4: Verify persistence and replay**

Flush and reload the atlas in the same test, resolve the need again, and assert the result remains `have` without rerunning the verification case.

- [ ] **Step 5: Record lab evidence and learning**

Write the measured input, output, status transitions, artifact reference, and limitation to `.kira/labs/phoenix-hardness/experiments.md` and `.kira/labs/phoenix-hardness/learning-memory.md`. Update `.kira/evidence.md` with the exact test command and result; do not claim external acquisition was implemented.

- [ ] **Step 6: Commit the end-to-end proof**

```sh
git add packages/hardness .kira/labs/phoenix-hardness .kira/evidence.md
git commit -m "test: verify HARDNESS unknown capability discovery path"
```

### Task 8: Documentation, composition, and gates

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/capability-seams.md`
- Modify: `packages/README.md`
- Modify: `tsconfig.host.json` and `tsconfig.client.json` aggregates to register each new package project reference exactly once
- Modify: the owning base composition manifest to mount the provider only after its persistence dependency is available
- Create: `packages/hardness/hardness/README.zh.md`
- Create: `packages/hardness/atlas-json/README.zh.md`
- Create or modify: owning Agent Note under `.agents/notes/implemented/architecture/`

- [ ] **Step 1: Document the live package contract**

Document `ctx.hardness`, the distinction between descriptors and granted permissions, resolver result kinds, persistence failure behavior, and the adapters' ownership. Keep detailed types in the package README and architecture map links.

- [ ] **Step 2: Run documentation checks**

Run `pnpm run verify-doc-budgets`, `pnpm run verify-md-links`, and the repository's documentation sync gate. Fix only errors caused by the new documents.

- [ ] **Step 3: Run focused and cross-package verification**

Run:

```sh
pnpm exec vitest run packages/hardness
pnpm exec tsc -b packages/hardness/hardness packages/hardness/atlas-json packages/hardness/adapters --pretty false
pnpm exec tsx scripts/run-oxlint.ts packages/hardness
pnpm run build
```

Expected result: all focused tests pass, typecheck exits 0, oxlint reports 0 warnings and 0 errors, and the full build exits 0.

- [ ] **Step 4: Inspect the final state**

Run `git diff --check` and `git status --short`. Confirm no credentials, generated `lib/` files, or unrelated snapshots are staged.

- [ ] **Step 5: Commit documentation and final gates**

```sh
git add docs packages/README.md packages/hardness .agents/notes/implemented/architecture .kira
git commit -m "docs: record HARDNESS capability atlas contract"
```

## Self-review checklist

- The spec requirement for a typed descriptor is covered by Tasks 1–2.
- Lifecycle states and evidence are covered by Tasks 2 and 4.
- Deterministic NEED resolution and honest unknown handling are covered by Task 3.
- Durable storage and corruption behavior are covered by Task 5.
- Tool/skill integration is covered by Task 6.
- Unknown-capability end-to-end proof and lab learning are covered by Task 7.
- Permission declaration without permission granting is covered by Tasks 1, 3, 6, and 8.
- Documentation and repository gates are covered by Task 8.
- No task depends on a model, provider, credential, or external API.
- No runtime visual, generative UI, workspace, acquisition, or automatic promotion code is included in this phase.
