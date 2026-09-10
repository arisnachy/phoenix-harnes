# PHOENIX Harness Audit and Repair Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for implementation tasks when delegation is used. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Test the local PHOENIX harness end to end, repair reproducible functional and visual defects, and verify equivalent harness behavior on local `stable` and `main` without discarding pre-existing changes.

**Architecture:** Use the current dirty `stable` checkout as the primary evidence target and create a temporary sibling worktree from local `main` for parity checks. Diagnose from assembled runtime evidence, write a failing regression test before production-code changes, keep provider-specific behavior inside adapters, and propagate only reviewed fixes to `main`.

**Tech Stack:** TypeScript, React, Cordis, Vitest, Vite, pnpm, Chromium/CDP, Git worktrees, local PHOENIX GUI.

**Spec:** `docs/superpowers/specs/2026-03-10-phoenix-harness-audit-repair-design.md`

## Global Constraints

- Preserve all pre-existing changes in `stable`; never run reset, clean, force checkout, or broad generated-file refresh.
- Use `C:\Users\arisn\OneDrive\Documentos\ChatGPT\Fenix-evolution\phoenix-harnes\phoenix-harnes` as the canonical checkout.
- Do not edit the shipped preset install, commit credentials, or include user documents in evidence.
- Distinguish repository defects from missing keys, provider quota, unavailable browsers, and local-server failures.
- Follow `AGENTS.md`, `docs/architecture.md`, `docs/testing.md`, and the relevant package `AGENTS.md` before edits.
- Every production behavior change requires a focused failing test, a minimal fix, and a fresh focused plus assembled verification.
- Visual claims require fresh desktop and narrow screenshots or an explicit documented environment blocker.
- Use Astra for the audit plan and review; route implementation and execution to the available Luna Max route, recording any route fallback instead of claiming it was used.

---

### Task 1: Capture immutable baselines without changing source

**Files:**
- Read: `AGENTS.md`, `docs/architecture.md`, `docs/testing.md`, `package.json`
- Inspect: `apps/web/tests`, `packages/client`, `packages/goal`, `packages/llm`, `packages/subagent`
- Evidence: external audit directory under `$env:TEMP\phoenix-harness-audit\`

**Interfaces:**
- Consumes: current `stable` worktree and local `main` ref.
- Produces: `stable-manifest.json`, `main-manifest.json`, command result logs, and a changed-file ownership map.

- [ ] **Step 1: Record runtime and branch identity**

Run from the canonical checkout:

```powershell
$repo = 'C:\Users\arisn\OneDrive\Documentos\ChatGPT\Fenix-evolution\phoenix-harnes\phoenix-harnes'
$out = Join-Path $env:TEMP 'phoenix-harness-audit'
New-Item -ItemType Directory -Force $out | Out-Null
node --version | Out-File (Join-Path $out 'runtime.txt')
pnpm --version | Add-Content (Join-Path $out 'runtime.txt')
git -C $repo branch --show-current | Set-Content (Join-Path $out 'stable-branch.txt')
git -C $repo status --short --branch | Set-Content (Join-Path $out 'stable-status.txt')
git -C $repo diff --stat | Set-Content (Join-Path $out 'stable-diff-stat.txt')
git -C $repo rev-parse HEAD | Set-Content (Join-Path $out 'stable-revision.txt')
git -C $repo merge-base main stable | Set-Content (Join-Path $out 'merge-base.txt')
```

Expected: the report identifies `stable`, its existing dirty files, the current revision, and the common ancestor without modifying tracked content.

- [ ] **Step 2: Create a temporary `main` worktree**

Run only if the target path does not already exist:

```powershell
$repo = 'C:\Users\arisn\OneDrive\Documentos\ChatGPT\Fenix-evolution\phoenix-harnes\phoenix-harnes'
$mainAudit = 'C:\Users\arisn\OneDrive\Documentos\ChatGPT\Fenix-evolution\phoenix-harnes\phoenix-harnes-main-audit'
git -C $repo worktree add --detach $mainAudit main
```

Expected: a clean detached worktree at `main` that leaves the dirty `stable` checkout untouched. If the path is already registered, inspect it with `git worktree list` and reuse it only when its status is clean.

- [ ] **Step 3: Verify dependency and build prerequisites**

Run in each target worktree:

```powershell
pnpm install --frozen-lockfile
pnpm exec vitest --version
pnpm exec tsc --version
```

Expected: dependency installation is either reproducible or the exact offline/registry blocker is recorded; no source file is rewritten by the install.

- [ ] **Step 4: Run the same keyless baseline on `stable` and `main`**

Run in each worktree and save output externally:

```powershell
pnpm run test
pnpm run build
pnpm run typecheck
pnpm run test:snapshot
pnpm run test:web
```

Expected: each command is classified as pass, fail, skip, timeout, or environment-blocked with exit code and first owning stack trace. Do not refresh snapshots during baseline.

---

### Task 2: Verify the local GUI and identify the real visual defect

**Files:**
- Inspect: `apps/web/index.html`, `apps/web/tests/scaffold.ts`, `packages/client/ui-trajectory/src/client/TrajectoryTable.tsx`, `packages/client/ui-trajectory/src/client/TrajectoryToolbar.tsx`, `packages/client/ui-subagent/src/client/SubagentHeaderLineage.tsx`
- Test: `apps/web/tests` relevant assembled and e2e suites
- Evidence: external desktop/mobile screenshots, DOM snapshots, and console logs

**Interfaces:**
- Consumes: a running `http://127.0.0.1:3080/` instance and the baseline result map.
- Produces: a mismatch ledger identifying exact user-visible symptoms, reproduction actions, owning files, and whether the issue is a defect or a correct fallback.

- [ ] **Step 1: Load the browser-control skill and check the existing target**

Use the dedicated Chrome profile path if available. If the browser plugin is unavailable, record that fact and use the repository's Playwright lane only when it can target the exact existing URL.

Target flow:

```text
app loads -> first meaningful screen renders -> primary visible controls respond without runtime errors
```

Expected: page identity, non-blank content, no framework overlay, and console errors/warnings are recorded before any edit.

- [ ] **Step 2: Capture desktop and narrow evidence**

Inspect Chat, model picker, activity/trajectory, tool cards, and any rendered chart/demo reachable from the current app. Check direct labels, scale/units, contrast, clipping, overflow, keyboard/touch affordances, and static screenshot readability.

Expected: the ledger names a specific defect instead of calling a visual “ugly” without a reproducible symptom. If no shipped chart path is reachable, do not invent a chart rewrite; audit trajectory and tool presentation instead.

- [ ] **Step 3: Exercise one interaction and confirm the resulting state**

Use a real visible control such as model selection, sidebar collapse, trajectory expansion, or new-session action. Record the state change in DOM text/attributes, URL, focus, or screenshot.

Expected: the interaction changes the intended state without a relevant console error or stale loading state.

---

### Task 3: Repair the first reproducible functional regression with TDD

**Files:**
- Candidate source: `packages/client/ui-subagent/src/client/SubagentHeaderLineage.tsx`
- Candidate test: `packages/client/ui-subagent/tests/conversation-ui.client.spec.tsx`
- Candidate assembled evidence: `apps/web/tests` matching the affected surface

**Interfaces:**
- Consumes: the mismatch ledger and a confirmed reproduction.
- Produces: a regression test that fails before the fix and passes after it, plus an assembled check proving the published path.

- [ ] **Step 1: Read the candidate source and nearby tests completely**

Confirm the exact sibling-rendering path, existing key construction, test harness, and package-level instructions before editing.

Expected: the hypothesis identifies the data-flow source of the symptom, not only the browser warning.

- [ ] **Step 2: Write the smallest failing regression test**

For the duplicate-key candidate, add a test that spies on `console.error`, renders the parent-session switcher with no `openTitle`, and asserts no duplicate-key warning is emitted while the semantic controls remain visible.

Expected: the test fails against the current implementation for the expected duplicate-key reason. If the candidate issue is not reproducible, replace it with the first confirmed defect from the ledger instead of forcing this test.

- [ ] **Step 3: Implement one minimal root-cause fix**

Use stable semantic keys derived from the lineage identity and the rendered variant; do not suppress console warnings globally or alter unrelated layout.

Expected: only the owning component and its regression test change in this task.

- [ ] **Step 4: Run focused and package tests**

```powershell
pnpm exec vitest run packages/client/ui-subagent/tests/conversation-ui.client.spec.tsx
pnpm exec vitest run packages/client/ui-subagent
```

Expected: the new test changes from the intended red failure to pass and the package suite reports no regression.

- [ ] **Step 5: Run the assembled web check for the repaired surface**

```powershell
pnpm run build
pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/built-boot.snapshot.ts
```

Expected: the built graph mounts and the repaired UI path remains visible in the assembled application.

---

### Task 4: Repair a visual surface only when the ledger proves a defect

**Files:**
- Modify only the renderer named by Task 2 evidence.
- Test: its package client spec and the matching `apps/web/tests` assembled/e2e or snapshot fixture.
- Document: owning package README or Agent Note only when the contract changes.

**Interfaces:**
- Consumes: desktop/mobile screenshots and the mismatch ledger.
- Produces: a semantic visual contract, deterministic fixture if needed, regression test, rebuilt artifacts, and before/after evidence.

- [ ] **Step 1: Write the visual acceptance test before changing CSS or markup**

Assert behavior rather than pixels alone: claim/title or accessible name is present, primary values and units are visible without hover, empty/loading/error states are distinct, keyboard focus is reachable, and the narrow layout keeps the primary evidence visible.

Expected: the new assertion fails against the current rendered output for the observed symptom.

- [ ] **Step 2: Apply the smallest visual correction**

Prefer direct labels, readable hierarchy, neutral context plus one intentional accent, honest scale, and fewer equal-weight cards. Remove only decorative effects that obscure evidence. Preserve the existing design tokens and plugin boundaries unless the defect is caused by their contract.

Expected: no new dependency and no unrelated component rewrite.

- [ ] **Step 3: Rebuild and run desktop plus narrow checks**

```powershell
pnpm run build
pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/built-boot.snapshot.ts
# Re-run the exact additional apps/web test file named by the mismatch ledger, if it differs from built-boot.snapshot.ts.
```

Capture fresh screenshots at one desktop and one narrow viewport. Expected: no clipping, overlap, unreadable labels, framework overlay, or unexplained console error; the interaction from Task 2 still works.

- [ ] **Step 4: Run a static-fallback check**

Verify that the changed visual surface remains interpretable in a screenshot or DOM snapshot without hover, animation, or an unavailable external resource.

Expected: the claim and key values survive export/replay.

---

### Task 5: Verify model-neutral cognition and durable learning paths

**Files:**
- Inspect and test only the packages identified by baseline evidence: model selection, `packages/core/session`, `packages/goal`, `packages/subagent`, `packages/message-feedback`, `packages/hardness`, and the relevant model adapter.
- Test: real composition fixtures under `examples/`, keyless snapshots, and built entry smokes.

**Interfaces:**
- Consumes: baseline failures and the effective provider/model route.
- Produces: a capability matrix with provider/model, reasoning option, visible tools, durable events, goal state, subagent report, feedback/memory provenance, and final artifact verification.

- [ ] **Step 1: Verify model selection and effective request configuration**

Run the focused model-settings and adapter tests identified by grep or baseline failure. Assert that selecting a model persists, invalid reasoning effort is rejected before network I/O, and the assembled request contains the selected provider/model without silently dropping declared tools.

Expected: provider-specific wire fields remain inside the adapter and the harness-level contract is identical across available models.

- [ ] **Step 2: Verify durable context and goal replay**

Run the goal, session, compaction, and snapshot scenarios that cover a multi-turn objective. Re-read persisted events externally and assert that the goal status, session identifiers, model-visible inputs, and continuation result survive reload/replay.

Expected: no hidden context reaches a model without a corresponding durable event.

- [ ] **Step 3: Verify subagent/tool/file/browser delivery**

Use real assembled fixtures where available. Check tool schemas, policy/approval, tool result persistence, subagent lineage/report, file byte output, and browser-visible state. Do not accept the agent's own completion text as proof.

Expected: each path either produces independently checked output or records its concrete environment blocker.

- [ ] **Step 4: Verify learning/feedback scope if the capability exists**

Record a feedback or memory item in a fixture, reload it, and query it from a second session/project. Assert that relevant evidence is reusable with provenance and unrelated session/project data is excluded.

Expected: if no durable learning provider exists in the shipped path, document that finding and do not fabricate an implementation under this audit.

- [ ] **Step 5: Add a regression only for a confirmed contract failure**

Follow the same red-green cycle as Task 3. Do not add generic “human cognition” prompt text as a substitute for durable state, evidence, or verification.

Expected: the fix is local to the owning seam and is covered by a keyless assembled snapshot when model-visible behavior changes.

---

### Task 6: Propagate reviewed repairs to local `main`

**Files:**
- Modify only files changed and proven in Tasks 3–5.
- Preserve all unrelated `stable` changes.
- Add or update one active Agent Note when the final change is non-trivial.

**Interfaces:**
- Consumes: focused commits or a reviewed patch from `stable` and clean `main` worktree.
- Produces: equivalent reviewed changes on `main` with no conflict-resolved behavior drift.

- [ ] **Step 1: Isolate mission changes from pre-existing `stable` work**

Use `git diff`, `git status`, and file-level ownership review. Stage only files created or modified by this mission; do not stage the existing snapshot/UI changes unless they are the confirmed repair and their ownership is proven.

Expected: the staged diff contains no credentials, unrelated user files, or broad regenerated outputs.

- [ ] **Step 2: Commit the focused repair on `stable`**

```powershell
git add --pathspec-from-file="$env:TEMP\phoenix-harness-audit\mission-files.txt"
git diff --cached --check
git commit -m "fix: harden harness audit findings"
```

Expected: the commit contains only the reviewed repair and required tests/docs.

- [ ] **Step 3: Apply the focused commit to `main`**

```powershell
$repo = 'C:\Users\arisn\OneDrive\Documentos\ChatGPT\Fenix-evolution\phoenix-harnes\phoenix-harnes'
$mainAudit = 'C:\Users\arisn\OneDrive\Documentos\ChatGPT\Fenix-evolution\phoenix-harnes\phoenix-harnes-main-audit'
git -C $mainAudit cherry-pick (git -C $repo rev-parse HEAD)
```

Resolve only source-level conflicts after comparing both sides; abort if a conflict would overwrite unrelated local work.

Expected: `main` contains the same semantic fix and test without accepting unrelated `stable` history.

- [ ] **Step 4: Run parity checks in both worktrees**

Run the exact focused tests, build/typecheck, relevant snapshots, and web built checks from Tasks 3–5 in both `stable` and `main`.

Expected: both branches have matching results or a documented branch-specific pre-existing difference; no new warning or failure appears on either branch.

---

### Task 7: Independent verification and handoff

**Files:**
- Evidence: external command logs, screenshots, DOM/console capture, git status, branch manifests.
- Update only if needed: active Agent Note and durable mission state.

**Interfaces:**
- Consumes: all implementation, test, visual, and parity evidence.
- Produces: an independent PASS/NEEDS_CHANGES verdict with remaining risk.

- [ ] **Step 1: Re-run the exact acceptance checks freshly**

Run the focused commands and visual flow after all edits; do not reuse a pre-edit output as proof of a post-edit claim.

Expected: evidence timestamps and revisions match the final source state.

- [ ] **Step 2: Audit security and reproducibility**

Check `git diff --cached --check`, `git status --short`, changed-file ownership, credentials patterns, generated artifacts, worktree registration, and the cleanup path for the temporary `main` worktree.

Expected: no secret or unrelated user file is part of the mission diff.

- [ ] **Step 3: Submit to an independent read-only judge**

The judge must inspect completeness, structure, visual presentation, security, maintainability, reproducibility, branch parity, and every acceptance criterion from the spec. A self-reported success is not sufficient.

Expected: only PASS permits completion. NEEDS_CHANGES becomes the next concrete work list; an external blocker remains explicitly waiting while independent checks continue.

- [ ] **Step 4: Remove only mission-owned temporary resources**

After evidence is captured and no process uses the worktree:

```powershell
$repo = 'C:\Users\arisn\OneDrive\Documentos\ChatGPT\Fenix-evolution\phoenix-harnes\phoenix-harnes'
$mainAudit = 'C:\Users\arisn\OneDrive\Documentos\ChatGPT\Fenix-evolution\phoenix-harnes\phoenix-harnes-main-audit'
git -C $repo worktree remove $mainAudit
```

Expected: the canonical dirty `stable` checkout remains intact and all mission evidence remains accessible outside source control.
