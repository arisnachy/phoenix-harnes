# HARDNESS Capability Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project verified HARDNESS routes into safe serializable UI surfaces consumed by existing PHOENIX slots.

**Architecture:** Add a pure host-side projection in `@deepseek-ai/dsh-hardness`; only `route` becomes a surface. A client adapter registers preview declarations into existing typed slots and contains no execution authority. Workspace and renderer services remain authoritative for mutation and rendering.

**Tech Stack:** TypeScript strict mode, Cordis, Vitest, existing slots/renderer/workspace packages.

---

### Task 1: Define and project `CapabilitySurface`

**Files:**
- Modify: `packages/hardness/hardness/src/types.ts`
- Create: `packages/hardness/hardness/src/surface.ts`
- Modify: `packages/hardness/hardness/src/index.ts`
- Test: `packages/hardness/hardness/tests/surface.spec.ts`

- [ ] Add failing tests for route projection, stable JSON serialization, permission visibility, and absence of executable keys.
- [ ] Add types `CapabilitySurface` and `CapabilitySurfaceResult` with only serializable fields.
- [ ] Implement `surfaceFromRoute(result)` returning `undefined` for `missing`/`unknown` and a frozen surface for `route`.
- [ ] Expose `surface(result)` from `HardnessService` without changing route semantics.
- [ ] Run `pnpm exec vitest run packages/hardness/hardness/tests/surface.spec.ts` and `pnpm exec tsc -b packages/hardness/hardness --pretty false`.
- [ ] Commit with `feat: expose safe HARDNESS capability surfaces`.

### Task 2: Register declarative previews in existing slots

**Files:**
- Modify: `packages/client/ui-workspace/src/client/contract/slots.ts`
- Modify: `packages/client/ui-workspace/src/client/index.ts`
- Test: `packages/client/ui-workspace/tests/apply.client.spec.ts`
- Test: `packages/client/ui-workspace/tests/surface.client.spec.ts`

- [ ] Add a typed preview declaration to the existing workspace slot contract; its props contain surface data only.
- [ ] Register the preview entry through the existing `slots.inject` lifecycle and return a reversible disposer.
- [ ] Test route → surface → slot registration and teardown; assert missing/unknown produce no entry.
- [ ] Run `pnpm exec vitest run packages/client/ui-workspace/tests/surface.client.spec.ts packages/client/ui-workspace/tests/apply.client.spec.ts`.
- [ ] Run the client package typecheck and oxlint.
- [ ] Commit with `feat: register HARDNESS surface previews in workspace slots`.

### Task 3: Documentation and evidence

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/architecture.zh.md`
- Modify: `packages/hardness/hardness/README.md`
- Modify: `packages/hardness/hardness/README.zh.md`
- Test: `packages/hardness/hardness/tests/surface.e2e.spec.ts`

- [ ] Add the route → surface → slot boundary and explicit Permission Broker boundary to documentation.
- [ ] Add an end-to-end fixture proving no executable payload crosses the surface boundary.
- [ ] Run focused HARDNESS and workspace tests, Host typecheck, oxlint, budgets, links, and `git diff --check`.
- [ ] Commit with `docs: document HARDNESS capability surfaces`.
