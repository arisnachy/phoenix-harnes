# PHOENIX P0 Main/Stable Release Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `main` the verified integration source and `stable` an exact release pointer to an approved green `main` SHA, while preserving rollback and updater safety.

**Architecture:** Keep the existing `phoenix/update-channel` metadata branch and managed-install updater. Run the complete existing CI matrix on every push to `main`; only a successful exact-main CI run may promote. The promotion synchronizes `stable` to that exact SHA with lease protection before publishing matching channel metadata. Preserve the pre-P0 stable head in `backup/stable-before-p0-20260903` before the one-time history reconciliation.

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
- Consumes: `.github/workflows/phoenix-stable-update-channel.yml`, `.github/workflows/ci.yml`
- Produces: regression assertions for exact stable synchronization and complete-CI promotion gating.

- [x] **Step 1: Write the failing release-pointer regression test**

Assert that the stable update workflow synchronizes `stable` to `TARGET_SHA` with `--force-with-lease`, does so before publishing metadata, and publishes manifest `sourceBranch` as `stable`.

- [x] **Step 2: Verify RED in CI**

The test-first PR produced a failing `node 24 / static` run before the release workflow implementation existed.

- [x] **Step 3: Keep the artifact promoter reachable by the static graph**

Import `./promote-client-artifacts.ts` from the contract spec, matching the verified stable-side hotfix, so Knip sees the updater helper as an intentional runtime dependency.

### Task 2: Synchronize stable to the exact approved main SHA

**Files:**
- Modify: `.github/workflows/phoenix-stable-update-channel.yml`
- Test: `scripts/phoenix-update-contract.spec.ts`

**Interfaces:**
- Consumes: `steps.target.outputs.sha`, current `origin/stable`, successful full `CI` workflow run on `main`.
- Produces: `refs/heads/stable == TARGET_SHA` before `.phoenix/channel/stable.json` is published.

- [x] **Step 1: Add stable synchronization**

Fetch `stable`, record its current SHA, and push the exact `TARGET_SHA` to `refs/heads/stable` using `--force-with-lease=refs/heads/stable:<observed-sha>`. If already equal, do nothing.

- [x] **Step 2: Make manifest metadata match the executable release pointer**

Set `sourceBranch` to `stable` while keeping `sourceCommit` equal to the exact `TARGET_SHA`.

- [x] **Step 3: Pin ordering and pointer semantics in tests**

The contract test requires synchronization before manifest publication.

### Task 3: Gate promotion on the complete existing CI matrix

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/phoenix-stable-update-channel.yml`
- Test: `scripts/phoenix-update-contract.spec.ts`

**Interfaces:**
- Consumes: exact pull-request or `main` push SHA.
- Produces: static, coverage, snapshots/artifacts, Node compatibility, Python SDK, Wine Windows, and native Windows results for the exact `main` SHA.

- [x] **Step 1: Run existing CI on pushes to main**

Add `push: branches: [main]` and allow all existing CI jobs plus the `all checks passed` aggregator to run for both PRs and main pushes.

- [x] **Step 2: Preserve the existing matrix instead of duplicating it in main guard**

Keep the current CI jobs intact: static, exhaustive coverage, consumers/snapshots/artifacts, Node 22/26 compatibility, Python SDK, Wine Windows, and native Windows.

- [x] **Step 3: Make stable publication depend on full CI**

Change `PHOENIX Stable Update Channel` to listen for successful `CI` completion on `main`, not the narrower `PHOENIX main guard`.

- [ ] **Step 4: Verify exact-head CI GREEN**

Require the complete PR CI matrix to pass on the final branch head before merge.

### Task 4: Reconcile and verify release branches

**Files:**
- No production file changes.

**Interfaces:**
- Consumes: merged green `main` SHA and backup branch `backup/stable-before-p0-20260903`.
- Produces: exact `main`/`stable` release alignment and preserved recovery history.

- [ ] **Step 1: Merge only after exact-head verification is green**

Do not merge the P0 PR while any required gate is red.

- [ ] **Step 2: Confirm complete CI on the merged main SHA**

Require the post-merge `CI` run on `main` to conclude successfully. The stable publisher will only proceed from this event.

- [ ] **Step 3: Verify one-time stable reconciliation**

The promotion workflow moves `stable` to the exact verified `main` SHA. The previous stable SHA remains recoverable through `backup/stable-before-p0-20260903`.

- [ ] **Step 4: Verify branch identity**

Compare `main...stable` and require no code or history divergence at the release pointer.

- [ ] **Step 5: Verify updater publication**

Confirm the stable channel manifest names the same release SHA and the updater self-test remains green.
