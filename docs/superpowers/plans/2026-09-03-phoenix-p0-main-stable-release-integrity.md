# PHOENIX P0 Main/Stable Release Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `main` the verified integration source and `stable` an exact release pointer to an approved green `main` SHA, while preserving rollback and updater safety.

**Architecture:** Keep the existing `phoenix/update-channel` metadata branch and managed-install updater. Strengthen the release workflow so it synchronizes `stable` to the exact current green `main` SHA before publishing the matching manifest, and pin that contract with regression tests. Preserve the pre-P0 stable head in `backup/stable-before-p0-20260903` before the one-time history reconciliation.

**Tech Stack:** GitHub Actions, Git, Node.js, TypeScript, Vitest, pnpm.

**Spec:** `docs/evolution/PHOENIX_AUTO_UPDATE.md`

## Global Constraints

- `main` remains the integration source of truth.
- `stable` is a promoted release pointer, not an independent development branch.
- Never promote a stale SHA.
- Preserve the existing preflight, recovery ref, rollback, and managed-install safety contracts.
- Never mutate user credentials, sessions, `$DSH_HOME`, or project data.
- Do not introduce automatic cross-provider model routing.

---

### Task 1: Pin stable release-pointer semantics

**Files:**
- Modify: `scripts/phoenix-update-contract.spec.ts`
- Test: `scripts/phoenix-update-contract.spec.ts`

**Interfaces:**
- Consumes: `.github/workflows/phoenix-stable-update-channel.yml`
- Produces: regression assertions that `stable` is synchronized with lease protection before the update-channel manifest is published.

- [ ] **Step 1: Write the failing regression test**

Add assertions that the stable update workflow contains a `Synchronize stable release pointer` step, pushes `TARGET_SHA` to `refs/heads/stable` with `--force-with-lease`, performs that step before `Publish stable manifest`, and publishes manifest `sourceBranch` as `stable`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run scripts/phoenix-update-contract.spec.ts`

Expected: FAIL because the current workflow publishes metadata but does not synchronize the `stable` branch and still writes `sourceBranch: main`.

- [ ] **Step 3: Keep the artifact promoter reachable by the static graph**

Import `./promote-client-artifacts.ts` from the contract spec, matching the verified stable-side hotfix, so Knip sees the updater helper as an intentional runtime dependency.

- [ ] **Step 4: Re-run the focused test**

Expected: release-pointer assertions remain RED until Task 2; existing artifact-promoter assertions remain green.

### Task 2: Synchronize stable to the exact approved main SHA

**Files:**
- Modify: `.github/workflows/phoenix-stable-update-channel.yml`
- Test: `scripts/phoenix-update-contract.spec.ts`

**Interfaces:**
- Consumes: `steps.target.outputs.sha`, current `origin/stable`, successful `PHOENIX main guard` workflow run.
- Produces: `refs/heads/stable == TARGET_SHA` before `.phoenix/channel/stable.json` is published.

- [ ] **Step 1: Add the minimal stable synchronization step**

After the stale-main check and updater self-test, fetch `stable`, record its current SHA, and push the exact `TARGET_SHA` to `refs/heads/stable` using `--force-with-lease=refs/heads/stable:<observed-sha>`. If already equal, do nothing.

- [ ] **Step 2: Make manifest metadata match the executable release pointer**

Set `sourceBranch` to `stable` while keeping `sourceCommit` equal to the exact `TARGET_SHA`.

- [ ] **Step 3: Run focused test and verify GREEN**

Run: `pnpm exec vitest run scripts/phoenix-update-contract.spec.ts`

Expected: PASS.

### Task 3: Strengthen the promotion gate

**Files:**
- Modify: `.github/workflows/phoenix-main-guard.yml`

**Interfaces:**
- Consumes: exact PR/push SHA.
- Produces: a release gate that covers repository static/integration checks in addition to typecheck/build/Windows inventory.

- [ ] **Step 1: Add repository-wide static/integration verification**

Run `pnpm run check:all` before build so runtime closure, package constraints, namespace, generated docs/config graphs, translation pairing, and Knip-style repository invariants can block promotion.

- [ ] **Step 2: Preserve existing Windows verification**

Keep `pnpm run typecheck`, `pnpm run build`, and `pnpm run check:ci:windows-blocking` as mandatory steps.

- [ ] **Step 3: Verify workflow syntax and exact-head CI**

Open a PR from `fix/p0-main-stable-release-integrity` into `main` and require the PR workflow to pass on the exact head SHA before merge.

### Task 4: Reconcile and verify release branches

**Files:**
- No production file changes.

**Interfaces:**
- Consumes: merged green `main` SHA and backup branch `backup/stable-before-p0-20260903`.
- Produces: exact `main`/`stable` release alignment and preserved recovery history.

- [ ] **Step 1: Merge only after exact-head verification is green**

Do not merge the P0 PR while any required gate is red.

- [ ] **Step 2: Confirm direct main guard on the merged SHA**

Require the post-merge `PHOENIX main guard` run to conclude successfully.

- [ ] **Step 3: Perform the one-time stable reconciliation**

Move `stable` to the exact verified `main` SHA. The previous stable SHA remains recoverable through `backup/stable-before-p0-20260903`.

- [ ] **Step 4: Verify branch identity**

Compare `main...stable` and require no code or history divergence at the release pointer.

- [ ] **Step 5: Verify updater publication**

Confirm the stable channel manifest names the same release SHA and the updater self-test remains green.
