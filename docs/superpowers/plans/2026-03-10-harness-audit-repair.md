# PHOENIX Harness Audit and Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the local PHOENIX harness on `stable` and `main`, repair reproducible functional and visual regressions, and leave both branches with independently verified evidence.

**Architecture:** Work from the clean local `stable` checkout, record reproducible defects before changing code, and propagate only focused commits to local `main` after `stable` passes. Keep provider quota failures separate from UI defects, and use the assembled web entry plus built tests for product-visible behavior.

**Tech Stack:** TypeScript, React, Vitest, Vite web shell, pnpm, Chrome CDP driver, Git.

**Spec:** User request in the active session: test the harness end to end, improve deficient graphics and missing or failing functions, and verify local `main` and `stable`.

## Global Constraints

- Use the exact checkout `C:\Users\arisn\OneDrive\Documentos\ChatGPT\Fenix-evolution\phoenix-harnes\phoenix-harnes`.
- Never commit credentials or alter the shipped preset install.
- Treat `stable` and `main` as separate verification targets; do not merge divergent branches blindly.
- Follow `AGENTS.md`, `docs/testing.md`, and the architecture extension rules.
- Every behavior change gets a focused regression test and the relevant assembled/built check.
- Visual claims require fresh screenshots from the local GUI and at least desktop plus mobile evidence when the surface is changed.

---

### Task 1: Establish reproducible baselines

**Files:**
- Read: `AGENTS.md`, `docs/testing.md`, `docs/architecture.md`, `package.json`
- Evidence: `.kira/audits/01-chat-baseline.png`, `.kira/audits/02-trajectory-baseline.png`

- [ ] Record Node, pnpm, branch, worktree, and branch-delta state.
- [ ] Run focused GUI tests, typecheck/build gates, keyless snapshots, and the relevant web built lane on `stable`.
- [ ] Repeat the same commands on `main`, recording timeout, failure, skip, warning, and pass counts separately.
- [ ] Capture the local GUI at `http://127.0.0.1:3080/` and inspect Chat, Trajectory, desktop, and mobile states.
- [ ] Classify provider quota/auth failures separately from harness defects.

### Task 2: Remove the reproducible duplicate-key warning

**Files:**
- Modify: `packages/client/ui-subagent/src/client/SubagentHeaderLineage.tsx`
- Test: `packages/client/ui-subagent/tests/conversation-ui.client.spec.tsx`

- [ ] Add a test that spies on `console.error`, renders the parent-session switcher with no `openTitle`, and asserts no duplicate-key warning is emitted.
- [ ] Run the focused test against the current code and confirm the new assertion fails because both sibling dropdowns use the same key.
- [ ] Change the two sibling keys to stable semantic keys derived from the lineage id and variant.
- [ ] Run the focused test and the whole `ui-subagent` test set, then confirm the warning is absent.

### Task 3: Verify the assembled visual surfaces

**Files:**
- Inspect: `apps/web/public/demos/canvas-scatterplot.html`
- Inspect: `packages/client/ui-trajectory/src/client/TrajectoryView.tsx`
- Inspect: `packages/client/ui-trajectory/src/client/TrajectoryTimeline.tsx`
- Inspect: `packages/client/ui-trajectory/src/client/views.module.css`
- Test: existing Canvas2D, navigation, and trajectory web tests

- [ ] Run the Canvas2D data and live demo tests with deterministic data.
- [ ] Capture the rendered chart and trajectory timeline, checking title claim, axes, direct labels, scale, contrast, responsive layout, keyboard/touch behavior, and static readability.
- [ ] If a visual defect is reproducible, write its smallest regression test before changing rendering code.
- [ ] Prefer semantic labels, meaningful hierarchy, and readable default state over decorative chart effects.
- [ ] Rebuild the affected web artifacts and repeat desktop/mobile screenshots after each visual fix.

### Task 4: Verify model/provider and cognition-facing flows

**Files:**
- Inspect: model settings, routing, session-learning, goal, subagent, tool and snapshot packages identified by failing evidence.
- Test: focused package suites plus keyless assembled snapshots and built entry smokes.

- [ ] Verify model selection persists, rejects invalid configurations, and exposes the selected provider/model in the assembled request.
- [ ] Verify session learning records provenance, filters by project/session, and survives reload without leaking unrelated memories.
- [ ] Verify subagent, goal, tool, file, and browser paths use real composition where product-visible.
- [ ] Treat missing provider credentials or quota as explicit environment evidence, never as a fabricated pass.

### Task 5: Propagate and verify both local branches

**Files:**
- Modify only files proven by Tasks 2–4.
- Add an Agent Note when the final change is non-trivial.

- [ ] Commit the focused repair(s) on `stable` only after fresh tests pass.
- [ ] Apply the same focused commit(s) to local `main` with cherry-pick or an equivalent conflict-reviewed operation.
- [ ] Run the focused tests, build/typecheck, keyless snapshots, and relevant web GUI checks on both branches.
- [ ] Confirm both worktrees are clean and no generated or credential files changed unexpectedly.

### Task 6: Independent audit and handoff

**Files:**
- Evidence: fresh command output, screenshots, git status, and test summaries.
- Optional: update the owning Agent Note and `.kira` durable state if that state mechanism exists in this checkout.

- [ ] Re-read every acceptance criterion and mark IMPLEMENTED, TESTED, VERIFIED, or remaining risk.
- [ ] Submit the exact deliverable to an independent read-only judge covering completeness, visual quality, security, reproducibility, maintainability, and branch parity.
- [ ] Do not claim completion until the judge returns PASS; if it returns changes, fix and re-run the affected evidence.
