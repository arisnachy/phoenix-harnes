# Trusted Connector Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Phoenix prefer curated official connectors over ambiguous registry matches, wire known OAuth connectors directly to Auth, and add safe uninstall/repair for Phoenix-managed MCP connectors.

**Architecture:** Keep the Official MCP Registry as discovery provenance only, while adding explicit curated/private provenance to Phoenix's connector catalog. Extend the Host-managed MCP overlay with source metadata plus generic remove/repair operations, expose those through the plugin-inventory Remote, then project a single lifecycle in Connectors UI that maps runtime/auth state to valid actions.

**Tech Stack:** TypeScript, React, Vitest, Cordis/Typert Remote APIs, Phoenix managed MCP overlay, Official MCP Registry.

**Spec:** `docs/superpowers/specs/2026-10-04-connector-trust-lifecycle-design.md`

## Global Constraints

- Known Phoenix integrations resolve from curated trusted definitions before generic registry search.
- Vendor identity and registry provenance are never conflated.
- Known OAuth connectors must be ready to authorize without generic registry search.
- Registry-discovered connectors remain labeled registry-listed and unverified as vendor-official.
- Every Phoenix-managed MCP must be removable from persistence and live runtime.
- Broken managed connectors must render as broken, not merely installed.
- Repair must re-resolve a trusted source; it must never reuse an arbitrary stale URL.
- EvolucionRD and KIRA Juancito Secure remain explicit `private-owner` connectors.
- Browser requests may not supply arbitrary executable commands, environment variables, or install URLs.
- Registry installs continue to be re-resolved Host-side.
- Managed removal must remove persistence before live unload.

## Review Focus

- A curated connector name collides with a registry result: curated identity must win and registry result must remain unverified.
- A legacy managed row has no source metadata: it must remain removable but must not offer unsafe repair.
- Persistence removal succeeds while Loader unload fails: connector must stay removed persistently and report partial failure.
- Runtime entry disappears while managed persistence remains: UI must show Broken and offer repair/uninstall, not Installed.
- OAuth popup/callback completes after install/repair: UI must refresh into Connected/Authorize state rather than remain stuck.

---

### Task 1: Add explicit connector provenance and managed-source types

**Files:**
- Modify: `packages/host/plugin-inventory/src/types.ts`
- Modify: `packages/client/ui-settings-models/src/client/connector-catalog.ts`
- Test: `packages/client/ui-settings-models/tests/connector-catalog.client.spec.ts`
- Test: `packages/host/plugin-inventory/tests/mcp-managed.spec.ts`

**Interfaces:**
- Produces:
  - `ConnectorProvenance = 'vendor-official' | 'registry-listed' | 'private-owner' | 'native'`
  - curated connector metadata with exact `provenance`, auth mode, and optional accepted registry identity.
  - `ManagedMcpSource = { kind: 'registry'; name: string; version?: string } | { kind: 'curated'; connectorId: string }`
  - `ManagedMcpConnector.source?: ManagedMcpSource`
- Consumes: existing connector catalog and managed MCP snapshot types.

- [ ] **Step 1: Write failing catalog tests**

Add tests asserting:
- Canva is `vendor-official`;
- EvolucionRD and KIRA Juancito Secure are `private-owner`;
- a curated connector may declare an accepted registry identity, but display name alone does not imply one;
- OAuth connectors expose their configured auth mode without registry lookup.

- [ ] **Step 2: Run the catalog tests**

Run:
`pnpm exec vitest run packages/client/ui-settings-models/tests/connector-catalog.client.spec.ts`

Expected: FAIL because provenance/source metadata does not exist yet.

- [ ] **Step 3: Write failing managed-source serialization tests**

In `mcp-managed.spec.ts`, assert:
- registry installs persist `source.kind === 'registry'`, exact name, and version;
- legacy rows without `source` still parse and appear in snapshots.

- [ ] **Step 4: Run managed MCP tests**

Run:
`pnpm exec vitest run packages/host/plugin-inventory/tests/mcp-managed.spec.ts`

Expected: FAIL because managed source metadata is not persisted/projected.

- [ ] **Step 5: Implement minimal provenance/source types**

Update catalog/type definitions and managed-row parsing/rendering while preserving compatibility with legacy rows.

- [ ] **Step 6: Re-run both focused tests**

Expected: PASS.

- [ ] **Step 7: Commit**

`git commit -am "feat(connectors): add trusted connector provenance"`

---

### Task 2: Add generic managed MCP remove and safe repair

**Files:**
- Modify: `packages/host/plugin-inventory/src/mcp-managed.ts`
- Modify: `packages/host/plugin-inventory/src/types.ts`
- Test: `packages/host/plugin-inventory/tests/mcp-managed.spec.ts`

**Interfaces:**
- Consumes: `ManagedMcpSource` from Task 1.
- Produces:
  - `remove(request: { entryId: string }): Promise<{ removed: boolean; liveUnloaded: boolean }>`
  - `repair(request: { entryId: string }): Promise<McpRegistryInstallReceipt>`

- [ ] **Step 1: Write failing remove tests**

Cover:
- removes only an exact Phoenix-managed `entryId`;
- removes persistence before calling Loader `remove`;
- missing IDs are idempotent and do not touch unrelated rows;
- Loader unload failure returns/throws a partial-failure result without restoring persistence.

- [ ] **Step 2: Run remove tests**

Run:
`pnpm exec vitest run packages/host/plugin-inventory/tests/mcp-managed.spec.ts -t "remove"`

Expected: FAIL because generic remove does not exist.

- [ ] **Step 3: Implement `ManagedMcpController.remove`**

Use existing `removeManagedRows` persistence-first behavior, restricted to exact managed entry IDs.

- [ ] **Step 4: Re-run remove tests**

Expected: PASS.

- [ ] **Step 5: Write failing repair tests**

Cover:
- registry source re-resolves exact registry name/version before reinstall;
- curated source uses an exact curated resolver, not the stale stored URL;
- legacy row without unambiguous source rejects repair with a clear error;
- repair of a failed row removes old persistence and creates a new managed entry.

- [ ] **Step 6: Run repair tests**

Expected: FAIL because generic repair does not exist.

- [ ] **Step 7: Implement `ManagedMcpController.repair`**

Use source metadata to reconstruct trusted configuration. Never accept a URL from the browser request.

- [ ] **Step 8: Run full managed MCP tests**

Run:
`pnpm exec vitest run packages/host/plugin-inventory/tests/mcp-managed.spec.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

`git commit -am "feat(connectors): add managed MCP remove and repair"`

---

### Task 3: Expose remove/repair through Host Remote and browser client

**Files:**
- Modify: `packages/host/plugin-inventory/src/index.ts`
- Modify: `packages/host/plugin-inventory/src/types.ts`
- Modify: `packages/client/ui-settings-models/src/client/index.ts`
- Modify: `packages/client/ui-settings-models/src/client/AuthorizationPanel.tsx`
- Test: `packages/host/plugin-inventory/tests/plugin-inventory.spec.ts` if present, otherwise `packages/host/plugin-inventory/tests/mcp-managed.spec.ts`
- Test: `packages/client/ui-settings-models/tests/components.client.spec.tsx` or connector-focused equivalent.

**Interfaces:**
- Produces Host Remotes:
  - `removeManagedMcpConnector({ entryId }): Promise<{ removed: boolean; liveUnloaded: boolean }>`
  - `repairManagedMcpConnector({ entryId }): Promise<McpRegistryInstallReceipt>`
- Extends `McpRegistryClient` with:
  - `remove(request: { entryId: string })`
  - `repair(request: { entryId: string })`

- [ ] **Step 1: Write failing Remote/client contract tests**

Assert the browser adapter forwards exact `entryId` only and unwraps Host errors.

- [ ] **Step 2: Run focused tests**

Expected: FAIL because methods are absent.

- [ ] **Step 3: Add Host Remote methods**

Delegate only to `ManagedMcpController.remove/repair`.

- [ ] **Step 4: Extend `PluginInventoryMcpRegistryRemote` and `mcpRegistryClient`**

Wire the two Remote methods to the browser-safe client.

- [ ] **Step 5: Run focused tests**

Expected: PASS.

- [ ] **Step 6: Regenerate Typert contracts**

Run:
`pnpm run build:typert`

Expected: generated contracts reflect the new Remote methods without errors.

- [ ] **Step 7: Commit**

`git commit -am "feat(connectors): expose managed connector lifecycle remotes"`

---

### Task 4: Make curated connector identity win over generic registry search

**Files:**
- Modify: `packages/client/ui-settings-models/src/client/AuthorizationPanel.tsx`
- Modify: `packages/client/ui-settings-models/src/client/connector-catalog.ts`
- Modify: `packages/client/ui-settings-models/src/client/connectors-locales.ts`
- Test: `packages/client/ui-settings-models/tests/connectors-section.client.spec.tsx`

**Interfaces:**
- Consumes curated provenance metadata from Task 1.
- Produces deterministic search precedence:
  - curated known result first;
  - generic Official MCP Registry only for unmatched or explicit registry search;
  - registry collision never inherits vendor trust.

- [ ] **Step 1: Write failing Canva-collision test**

Mock registry search to return a third-party server titled `Canva`. Search for `Canva` and assert:
- curated Canva appears as vendor-official;
- the registry result is not chosen as the primary install/auth action;
- registry result, if shown, says `Registry-listed · vendor not verified`.

- [ ] **Step 2: Run collision test**

Run:
`pnpm exec vitest run packages/client/ui-settings-models/tests/connectors-section.client.spec.tsx -t "Canva"`

Expected: FAIL with current registry-first/ambiguous behavior.

- [ ] **Step 3: Implement curated-first search resolution**

Do not infer trust from title/name equality. Keep explicit registry search available for unknown services.

- [ ] **Step 4: Add private-owner regression test**

Assert EvolucionRD and KIRA Juancito Secure are not replaced by public registry matches.

- [ ] **Step 5: Run connector section tests**

Expected: PASS.

- [ ] **Step 6: Commit**

`git commit -am "fix(connectors): prefer curated official identities"`

---

### Task 5: Project real connector health and eliminate dead actions

**Files:**
- Modify: `packages/client/ui-settings-models/src/client/AuthorizationPanel.tsx`
- Modify: `packages/client/ui-settings-models/src/client/connectors-locales.ts`
- Modify: `packages/client/ui-settings-models/src/client/ConnectorsSection.module.css`
- Test: `packages/client/ui-settings-models/tests/connectors-section.client.spec.tsx`
- Test: `packages/client/ui-settings-models/tests/authorization-popup.client.spec.tsx`

**Interfaces:**
- Consumes:
  - managed connector state/source;
  - MCP runtime `status`;
  - authorization entries.
- Produces UI lifecycle:
  - `available | installing | installed | auth-required | authorizing | connected | reconnect-required | failed | repairing | removing`.

- [ ] **Step 1: Write failing lifecycle tests**

Assert:
- managed + runtime `ready` => Installed/Connected as appropriate;
- managed + runtime `auth-required` => Authorize/Reauthorize;
- managed + runtime `failed` => Broken + Repair + Uninstall;
- managed + no runtime => Broken;
- a button is not enabled when the required client capability is absent.

- [ ] **Step 2: Run lifecycle tests**

Expected: FAIL because current rendering can show Installed and dead actions.

- [ ] **Step 3: Implement a single lifecycle derivation helper**

Derive card state from managed/runtime/auth facts before rendering buttons.

- [ ] **Step 4: Wire Install -> refresh -> Auth**

After a curated MCP install or repair, refresh state; if runtime reports `auth-required`, immediately expose the registered Auth action. Do not require a second search.

- [ ] **Step 5: Wire Uninstall and Repair buttons**

Use `mcpRegistry.remove/repair`, surface failures, and refresh state after completion.

- [ ] **Step 6: Verify stuck OAuth regression**

Run:
`pnpm exec vitest run packages/client/ui-settings-models/tests/authorization-popup.client.spec.tsx packages/client/ui-settings-models/tests/connectors-section.client.spec.tsx`

Expected: PASS, including cancellation/completion restoring actions.

- [ ] **Step 7: Commit**

`git commit -am "fix(connectors): wire auth repair and uninstall lifecycle"`

---

### Task 6: Keep Models authentication-free and remove misleading API-key copy

**Files:**
- Modify only if failing: `packages/client/ui-settings-models/src/client/ModelsSection.tsx`
- Modify only if failing: `packages/client/ui-settings-models/src/client/ProviderEditor.tsx`
- Test: `packages/client/ui-settings-models/tests/components.client.spec.tsx`
- Test: `packages/client/ui-settings-models/tests/connectors-section.client.spec.tsx`

**Interfaces:**
- Consumes existing Models/Connectors split.
- Produces invariant: account OAuth management lives in Connectors; Models may show model configuration but not duplicate connector authorization cards.

- [ ] **Step 1: Add regression assertions**

Assert the legacy `AuthorizationPanel` remains empty in Models and OAuth providers do not display `API key missing` copy when their auth mode is account/OAuth.

- [ ] **Step 2: Run tests**

Expected: either PASS already, or FAIL only where misleading copy remains.

- [ ] **Step 3: Make the minimal correction only if needed**

Do not refactor Models unrelated to the failing invariant.

- [ ] **Step 4: Re-run focused tests**

Expected: PASS.

- [ ] **Step 5: Commit if production changed**

`git commit -am "fix(settings): keep account auth in connectors"`

---

### Task 7: Full connector verification and build gates

**Files:**
- No new production code unless verification exposes a regression.
- Update snapshots only when behavior change is intentional and reviewed.

**Interfaces:**
- Consumes all prior tasks.
- Produces a verified feature branch suitable for merge.

- [ ] **Step 1: Run focused connector/host suite**

`pnpm exec vitest run packages/host/plugin-inventory/tests/mcp-managed.spec.ts packages/host/plugin-inventory/tests/mcp-registry.spec.ts packages/client/ui-settings-models/tests/connector-catalog.client.spec.ts packages/client/ui-settings-models/tests/connectors-section.client.spec.tsx packages/client/ui-settings-models/tests/authorization-popup.client.spec.tsx`

Expected: 0 failures.

- [ ] **Step 2: Run host build**

`pnpm run build:lib:host`

Expected: exit 0.

- [ ] **Step 3: Run client build**

`pnpm run build:lib:client`

Expected: exit 0.

- [ ] **Step 4: Run GUI suite**

`pnpm run test:gui`

Expected: 0 failures; any inherited failures must be named before merge.

- [ ] **Step 5: Run primary CI gate**

`pnpm run check:ci`

Expected: exit 0, or document pre-existing unrelated failures with evidence before deciding whether merge is safe.

- [ ] **Step 6: Whole-branch review**

Review:
- trust boundary;
- arbitrary URL/package injection;
- legacy-row migration;
- persistence-first uninstall;
- OAuth action recovery;
- private-owner isolation.

- [ ] **Step 7: Merge to main only with exact reviewed head SHA**

Use a PR and expected head SHA.

- [ ] **Step 8: Promote the verified main tree to stable**

Fast-forward `stable` to the verified `main` commit when possible.

- [ ] **Step 9: Verify branch parity**

Confirm `main` and `stable` point to equivalent content and report CI truthfully.
