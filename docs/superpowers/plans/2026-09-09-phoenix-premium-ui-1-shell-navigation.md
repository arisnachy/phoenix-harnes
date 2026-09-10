# PHOENIX Premium UI — UI-1 Shell and Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PHOENIX's shell, sidebar session navigation, and conversation header feel materially closer to the calm, compact interaction style of ChatGPT/Codex while preserving all session/runtime semantics and the recently fixed writable-composer hand-off.

**Architecture:** UI-1 is presentation-first. Keep `WorkspaceRuntime`, session creation/opening, and the `InputBar` machine untouched. Refine existing CSS Modules and row components; derive optional flat-list recency headings solely from existing `SessionNode.updatedAt`. The conversation header keeps its current slots, ancestry, actions, utilities, and tabs, but receives quieter geometry and monochrome styling. No new dependencies.

**Tech Stack:** React, TypeScript ESM, CSS Modules, existing PHOENIX design tokens/primitives, Vitest + Testing Library, pnpm 11.

**Spec:** `docs/superpowers/specs/2026-09-09-phoenix-premium-ui-design.md`

## Global Constraints

- Do not modify `packages/client/runtime/src/client/workspaces/service.ts` in UI-1.
- Do not modify `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` in UI-1.
- Preserve the New Session regression fix: a writable current session stays selected until the replacement session is ready, then the UI switches directly.
- Preserve workspace grouping, drag/reorder, search, rename, fork, archive, delete, status-dot, and subagent behavior.
- Use existing semantic tokens; do not hard-code new theme colors.
- Keep motion in the 120–180 ms range and preserve `prefers-reduced-motion` behavior.
- Hover-only actions must also be reachable/visible from keyboard focus.
- Land UI-1 on `main` first. After verification, port the same logical changes independently to `stable`; never wholesale-merge the diverged branches.
- A failed typing/session regression gate blocks merge even if visual tests pass.

---

## File Map

### Sidebar shell

- Modify: `packages/client/ui-sidebar/src/client/SidebarRoot.module.css`
- Modify: `packages/client/ui-sidebar/tests/sidebar-styles.client.spec.ts`
- Verify: `packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx`
- Verify: `packages/client/ui-sidebar/tests/sidebar-snapshot.client.spec.tsx`

### Workspace/session navigation

- Modify: `packages/client/ui-workspace/src/client/rows/Rows.tsx`
- Modify: `packages/client/ui-workspace/src/client/rows/Rows.module.css`
- Modify: `packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx`
- Modify: `packages/client/ui-workspace/src/client/WorkspaceBrowser.module.css`
- Modify: `packages/client/ui-workspace/src/client/locales.ts`
- Create: `packages/client/ui-workspace/src/client/recency.ts`
- Create: `packages/client/ui-workspace/tests/recency.client.spec.ts`
- Modify: `packages/client/ui-workspace/tests/rows.client.spec.tsx`
- Modify: `packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx`
- Verify: `packages/client/ui-workspace/tests/browser-styles.client.spec.ts`
- Verify: `packages/client/ui-workspace/tests/tree.client.spec.ts`

### Conversation top bar

- Modify: `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css`
- Create: `packages/client/ui-conversation/tests/conversation-header-styles.client.spec.ts`
- Verify: `packages/client/ui-conversation/tests/chat-view.client.spec.tsx`
- Verify: `packages/client/ui-conversation/tests/assembly-surfaces.client.spec.tsx`

### Critical regression gate

- Verify unchanged: `packages/client/runtime/tests/new-session-current-blank.client.spec.ts`

---

## Task 1: Tighten the PHOENIX sidebar shell

**Files:** `packages/client/ui-sidebar/src/client/SidebarRoot.module.css`, `packages/client/ui-sidebar/tests/sidebar-styles.client.spec.ts`

- [ ] **Step 1: Update the CSS contract test first.**

Change the expected expanded geometry to the premium compact values:

```ts
expect(root?.get('--dsh-sidebar-inline-padding')).toBe('10px')
expect(root?.get('padding')).toBe('6px var(--dsh-sidebar-inline-padding)')

expect(declarations('.logoRow')?.get('height')).toBe('52px')
expect(declarations('.logoRow')?.get('margin-bottom')).toBe('4px')
expect(declarations('.brandIdentity')?.get('height')).toBe('36px')
expect(declarations('.brandMark img')?.get('width')).toBe('36px')
expect(declarations('.brandMark img')?.get('height')).toBe('36px')
expect(declarations('.brandName')?.get('height')).toBe('30px')
expect(declarations('.brandName')?.get('font-size')).toBe('18px')
expect(declarations('.brandName')?.get('letter-spacing')).toBe('0.16em')
```

Keep the existing New Session expectations at 36px high, 100% wide, borderless-at-rest, left aligned. Add an assertion that `.newSession:focus-visible` uses the same quiet interaction background and an explicit focus outline.

- [ ] **Step 2: Run the test and confirm RED.**

Run:

```bash
pnpm exec vitest run packages/client/ui-sidebar/tests/sidebar-styles.client.spec.ts
```

Expected: FAIL because the current shell still uses 12px inline padding, 60px logo row, 42px mark, and 20px wordmark.

- [ ] **Step 3: Implement the compact sidebar geometry.**

In `SidebarRoot.module.css`:

```css
.root {
  --dsh-sidebar-inline-padding: 10px;
}

.logoRow {
  height: 52px;
  margin-bottom: 4px;
}

.brandIdentity {
  height: 36px;
}

.brandMark img {
  width: 36px;
  height: 36px;
}

.brandName {
  height: 30px;
  padding-left: 10px;
  font-size: 18px;
  letter-spacing: 0.16em;
}

.newSession:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover);
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: -2px;
}
```

Do not change the collapsed 36px rail geometry.

- [ ] **Step 4: Run focused sidebar tests.**

Run:

```bash
pnpm exec vitest run \
  packages/client/ui-sidebar/tests/sidebar-styles.client.spec.ts \
  packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx \
  packages/client/ui-sidebar/tests/sidebar-snapshot.client.spec.tsx
```

Expected: PASS. If the snapshot changes only because of expected presentation/class output, review and refresh through the repository's established snapshot workflow rather than deleting assertions.

- [ ] **Step 5: Commit.**

```bash
git add packages/client/ui-sidebar/src/client/SidebarRoot.module.css packages/client/ui-sidebar/tests/sidebar-styles.client.spec.ts
git commit -m "style: refine Phoenix sidebar shell"
```

---

## Task 2: Make session rows quiet, compact, and keyboard-complete

**Files:** `packages/client/ui-workspace/src/client/rows/Rows.tsx`, `packages/client/ui-workspace/src/client/rows/Rows.module.css`, `packages/client/ui-workspace/tests/rows.client.spec.tsx`

- [ ] **Step 1: Add behavioral regression tests before changing the row.**

Extend `rows.client.spec.tsx` with a test that renders a normal `SessionNodeItem` and verifies:

```ts
const row = screen.getByRole('treeitem')
expect(row.tabIndex).toBe(0)
fireEvent.keyDown(row, { key: 'Enter' })
expect(onOpen).toHaveBeenCalledWith(node.id)

onOpen.mockClear()
fireEvent.keyDown(row, { key: ' ' })
expect(onOpen).toHaveBeenCalledWith(node.id)
```

Add a test that the row action button remains keyboard reachable and that pressing Enter on the action button does not also invoke `onOpen`.

- [ ] **Step 2: Run the row tests and confirm RED.**

Run:

```bash
pnpm exec vitest run packages/client/ui-workspace/tests/rows.client.spec.tsx
```

Expected: at least the new keyboard-row assertion fails before implementation.

- [ ] **Step 3: Add explicit keyboard activation without changing pointer/drag semantics.**

On the session row root, keep the existing `role="treeitem"`, `aria-selected`, pointer click, menu, and drag handlers. Add:

```tsx
tabIndex={0}
onKeyDown={(event) => {
  if (event.target !== event.currentTarget) return
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  onOpen(node.id)
}}
```

Do not attach this handler to nested action buttons; the `event.target !== event.currentTarget` guard prevents menu-button keyboard activation from opening the session.

- [ ] **Step 4: Refine row CSS.**

Keep the current 32px session row and 34px project row heights. Preserve borderless rows. Change only interaction hierarchy:

```css
.projectRow:focus-within,
.sessionRow:focus-within,
.projectRow:hover,
.sessionRow:hover,
.sessionRow.selected {
  background: var(--dsw-alias-interactive-bg-hover);
}

.projectRow:focus-within .rowActions,
.sessionRow:focus-within .rowActions,
.projectRow:hover .rowActions,
.sessionRow:hover .rowActions,
.projectRow.menuOpen .rowActions,
.sessionRow.menuOpen .rowActions {
  display: inline-flex;
}

.sessionRow:focus-within .time,
.sessionRow:hover .time,
.sessionRow.menuOpen .time {
  display: none;
}

.sessionRow:focus-visible,
.projectRow:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: -2px;
}

.rowActions {
  gap: 2px;
}

.iconButton {
  width: 24px;
  height: 24px;
  border-radius: 6px;
}

.time {
  font-size: 11px;
  line-height: 16px;
}
```

If the project root is not currently focusable, do not expand scope to rework its drag semantics in this task; its nested buttons already remain keyboard targets. Session navigation itself must become keyboard complete.

- [ ] **Step 5: Run row and browser style tests.**

Run:

```bash
pnpm exec vitest run \
  packages/client/ui-workspace/tests/rows.client.spec.tsx \
  packages/client/ui-workspace/tests/browser-styles.client.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/client/ui-workspace/src/client/rows/Rows.tsx packages/client/ui-workspace/src/client/rows/Rows.module.css packages/client/ui-workspace/tests/rows.client.spec.tsx
git commit -m "style: refine session navigation rows"
```

---

## Task 3: Add ChatGPT-style recency sections in flat session mode

**Files:** `packages/client/ui-workspace/src/client/recency.ts`, `packages/client/ui-workspace/tests/recency.client.spec.ts`, `packages/client/ui-workspace/src/client/locales.ts`, `packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx`, `packages/client/ui-workspace/src/client/WorkspaceBrowser.module.css`, `packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx`

The existing workspace-grouped view stays workspace-grouped. Recency headings apply only to the existing hierarchy-free flat mode, where the sessions are already newest-first.

- [ ] **Step 1: Write pure bucket tests.**

Create `recency.client.spec.ts` with a fixed local noon and rows on the four boundaries. Test the pure API:

```ts
expect(recencyBucket(atToday, now)).toBe('today')
expect(recencyBucket(atYesterday, now)).toBe('yesterday')
expect(recencyBucket(atThreeDaysAgo, now)).toBe('last7Days')
expect(recencyBucket(atEightDaysAgo, now)).toBe('older')
```

Also assert that `partitionByRecency` preserves row order inside each bucket and omits empty buckets.

- [ ] **Step 2: Run the new pure test and confirm RED.**

Run:

```bash
pnpm exec vitest run packages/client/ui-workspace/tests/recency.client.spec.ts
```

Expected: FAIL because `recency.ts` does not exist.

- [ ] **Step 3: Implement the DST-safe local-calendar helper.**

Create:

```ts
export type RecencyBucket = 'today' | 'yesterday' | 'last7Days' | 'older'

function startOfLocalDay(value: number): number {
  const d = new Date(value)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function daysBefore(start: number, days: number): number {
  const d = new Date(start)
  d.setDate(d.getDate() - days)
  return d.getTime()
}

export function recencyBucket(updatedAt: number, now: number): RecencyBucket {
  const today = startOfLocalDay(now)
  const yesterday = daysBefore(today, 1)
  const last7 = daysBefore(today, 6)
  if (updatedAt >= today) return 'today'
  if (updatedAt >= yesterday) return 'yesterday'
  if (updatedAt >= last7) return 'last7Days'
  return 'older'
}
```

`partitionByRecency` must iterate the already ordered rows once and return only non-empty groups in fixed order: today, yesterday, last7Days, older.

- [ ] **Step 4: Add localized labels.**

Add these keys to the `zh` source-of-truth and matching `en` and `es` dictionaries:

```ts
'recency.today': '今天'       // en: Today, es: Hoy
'recency.yesterday': '昨天'   // en: Yesterday, es: Ayer
'recency.last7Days': '最近 7 天' // en: Last 7 days, es: Últimos 7 días
'recency.older': '更早'       // en: Older, es: Anteriores
```

Preserve the repository's dictionary key parity checks.

- [ ] **Step 5: Render recency sections only in flat mode.**

Where `WorkspaceBrowser.tsx` currently maps `deriveFlat(...)` directly, replace only that flat-list rendering with `partitionByRecency(flatRows, now)`. Render each non-empty section with a stable `data-recency-bucket` and a quiet heading before its existing `SessionNodeItem` rows. Do not change grouped workspace rendering, search-result rendering, or row ordering.

Add CSS:

```css
.recencySection + .recencySection {
  margin-top: 10px;
}

.recencyLabel {
  padding: 6px 8px 4px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
}
```

The label is informational, not an interactive tree row.

- [ ] **Step 6: Add an integration test for labels/order.**

In `workspace-browser.client.spec.tsx`, render flat mode with sessions distributed across the four buckets. Assert the headings appear in order and each session remains under the expected heading. Assert workspace-grouped mode does not render recency headings.

- [ ] **Step 7: Run workspace navigation tests.**

Run:

```bash
pnpm exec vitest run \
  packages/client/ui-workspace/tests/recency.client.spec.ts \
  packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx \
  packages/client/ui-workspace/tests/tree.client.spec.ts \
  packages/client/ui-workspace/tests/rows.client.spec.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add packages/client/ui-workspace/src/client/recency.ts packages/client/ui-workspace/tests/recency.client.spec.ts packages/client/ui-workspace/src/client/locales.ts packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx packages/client/ui-workspace/src/client/WorkspaceBrowser.module.css packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx
git commit -m "feat: group flat sessions by recency"
```

---

## Task 4: Simplify the conversation top bar without changing its slot contract

**Files:** `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css`, `packages/client/ui-conversation/tests/conversation-header-styles.client.spec.ts`

- [ ] **Step 1: Create a CSS contract test.**

Use the same lightweight declaration parser pattern already used by `ui-sidebar/tests/sidebar-styles.client.spec.ts`. Assert:

```ts
expect(declarations('.header')?.get('padding')).toBe('8px 16px 0')
expect(declarations('.titleRow')?.get('min-height')).toBe('36px')
expect(declarations('.titleCluster')?.get('gap')).toBe('6px')
expect(declarations('.crumb')?.get('border-radius')).toBe('8px')
expect(declarations('.crumb')?.get('padding')).toBe('4px 6px')
expect(declarations('.headerActions')?.get('gap')).toBe('4px')
expect(declarations('.headerUtilities')?.get('gap')).toBe('4px')
expect(declarations('.headerUtilities')?.get('margin-left')).toBe('12px')
expect(declarations('.tabs')?.get('gap')).toBe('24px')
expect(declarations('.tabActive')?.get('color')).toBe('var(--dsw-alias-label-primary)')
```

Also assert `.tabActive::after` uses `var(--dsw-alias-label-primary)` so the selected tab becomes monochrome-first instead of business blue.

- [ ] **Step 2: Run the test and confirm RED.**

Run:

```bash
pnpm exec vitest run packages/client/ui-conversation/tests/conversation-header-styles.client.spec.ts
```

Expected: FAIL against the current 12/28/20 padding, 8px action gaps, 36px tab gap, and blue active tab.

- [ ] **Step 3: Implement the CSS-only top-bar refinement.**

Change only `ConversationRoot.module.css`:

```css
.header {
  padding: 8px 16px 0;
}

.titleRow {
  min-height: 36px;
}

.titleCluster {
  gap: 6px;
}

.crumb {
  max-width: 260px;
  padding: 4px 6px;
  border-radius: 8px;
}

.crumbCurrent {
  font-weight: 600;
}

.headerActions,
.headerUtilities {
  gap: 4px;
}

.headerUtilities {
  margin-left: 12px;
}

.tabs {
  gap: 24px;
  margin-top: 0;
  padding-left: 6px;
}

.tab {
  padding-bottom: 9px;
}

.tabActive {
  color: var(--dsw-alias-label-primary);
}

.tabActive::after {
  background: var(--dsw-alias-label-primary);
}
```

Do not edit `ConversationSession.tsx`: ancestry crumbs, action slots, utility slots, view tabs, ARIA, and click behavior stay intact.

- [ ] **Step 4: Run conversation header/view regressions.**

Run:

```bash
pnpm exec vitest run \
  packages/client/ui-conversation/tests/conversation-header-styles.client.spec.ts \
  packages/client/ui-conversation/tests/chat-view.client.spec.tsx \
  packages/client/ui-conversation/tests/assembly-surfaces.client.spec.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css packages/client/ui-conversation/tests/conversation-header-styles.client.spec.ts
git commit -m "style: simplify conversation top bar"
```

---

## Task 5: Prove UI-1 does not regress New Session or typing

**Files:** verification only; no runtime/input implementation changes expected.

- [ ] **Step 1: Run the critical New Session hand-off test.**

Run:

```bash
pnpm exec vitest run packages/client/runtime/tests/new-session-current-blank.client.spec.ts
```

Expected: PASS, including the assertion that the current session remains selected while a new session is pending and switches only after the new session is ready.

- [ ] **Step 2: Run focused conversation input tests.**

Run:

```bash
pnpm exec vitest run \
  packages/client/ui-conversation/tests/input-bar.client.spec.tsx \
  packages/client/ui-conversation/tests/input-machine.client.spec.ts
```

If either exact filename has changed in the branch, use `git ls-files 'packages/client/ui-conversation/tests/*input*'` and run the tracked input-bar/input-machine equivalents; do not skip the input regression family.

Expected: PASS.

- [ ] **Step 3: Run the complete UI-1 focused gate.**

Run:

```bash
pnpm exec vitest run \
  packages/client/ui-sidebar/tests/sidebar-styles.client.spec.ts \
  packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx \
  packages/client/ui-workspace/tests/rows.client.spec.tsx \
  packages/client/ui-workspace/tests/browser-styles.client.spec.ts \
  packages/client/ui-workspace/tests/tree.client.spec.ts \
  packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx \
  packages/client/ui-workspace/tests/recency.client.spec.ts \
  packages/client/ui-conversation/tests/conversation-header-styles.client.spec.ts \
  packages/client/runtime/tests/new-session-current-blank.client.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Build/typecheck the client.**

Run:

```bash
pnpm run build:lib:client
pnpm run build:web
```

Expected: both PASS.

- [ ] **Step 5: Run diff hygiene.**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 6: Inspect scope before PR.**

Run:

```bash
git diff --name-only main...HEAD
```

Expected: only UI-1 implementation/tests plus the already approved design/plan docs if the implementation branch includes them. No runtime service or `InputBar.tsx` changes.

---

## Task 6: Integrate UI-1 into main, then stable independently

- [ ] **Step 1: Open a focused PR to `main`.**

Use branch `feat/phoenix-premium-ui-1-20260909`. PR body must state the visual changes, the no-runtime/no-InputBar constraint, and the New Session/typing regression gates that passed.

- [ ] **Step 2: Wait for/inspect relevant CI.**

Required before merge: focused tests above green, client build green, and no new failure attributable to UI-1. Existing unrelated repository diagnostics must be identified explicitly rather than silently ignored.

- [ ] **Step 3: Merge to `main` only after verification.**

Prefer squash or the repository's current PR convention. Record the resulting main SHA.

- [ ] **Step 4: Create a fresh stable-port branch from the current `stable` tip.**

Use branch `feat/phoenix-premium-ui-1-stable-20260909`. Port the same logical file changes; do not merge `main` into `stable`.

- [ ] **Step 5: Repeat the focused tests/build on the stable-port branch.**

Run the same commands from Task 5 against the stable port. Any divergence-specific adjustment requires its own test and must preserve the UI-1 contract.

- [ ] **Step 6: Open and merge the stable PR after verification.**

Record the resulting stable SHA. Once `stable` advances, the local PHOENIX updater can discover the new stable tip on its normal polling cycle when the local checkout is eligible and clean; do not claim a user's machine updated until it reports/observes the new revision.

---

## Self-review checklist

- [ ] No `TODO`, `TBD`, or unresolved implementation choice remains in this plan.
- [ ] UI-1 covers sidebar density, session-row interaction, recency grouping in the supported flat view, and top-bar simplification.
- [ ] UI-1 deliberately excludes composer restyling, activity/tool-call rendering, contextual right panel, command palette, usage popover, and theme polish; those remain UI-2 through UI-5.
- [ ] `WorkspaceRuntime.startSession` and `InputBar.tsx` are explicitly out of scope.
- [ ] The plan includes a failing-test-first step for every behavior change and focused tests for presentation changes.
- [ ] Main and stable integration are separate because their histories diverge.
