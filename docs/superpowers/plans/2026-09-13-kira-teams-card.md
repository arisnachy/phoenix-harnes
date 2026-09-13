# KIRA Teams Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing KIRA teams view into an in-flow floating card with stable illustrated SVG agent identities plus separate visible role and current-action text.

**Architecture:** Keep the existing `shell.overlay` registration, lineage read model, and session actions unchanged. The component remains presentation-only over the injected sessions face; the change is limited to derived display helpers, locale keys, JSX hierarchy, SVG avatar rendering, and CSS Modules. The panel continues to reserve layout space instead of covering the chat.

**Tech Stack:** React, TypeScript, CSS Modules, Vitest, Phoenix client slot framework.

**Spec:** Existing approved KIRA UI concept in this feature branch; the red tests in `packages/client/ui-kira-teams/tests/` are the executable contract.

## Global Constraints

- Do not add a new slot, service, context access, or public client-package export.
- Keep `shell.overlay`, injected `sessions` data/actions, and lineage semantics intact.
- Render SVG agent artwork without emoji-dependent glyphs.
- Use existing semantic Phoenix CSS variables for new card/background/border/text behavior.
- Preserve reduced-motion behavior and existing model-family fallback avatars when `agentId` is absent.
- All new locale keys must exist in Chinese, English, and Spanish dictionaries.

---

### Task 1: Derive role and current action

**Files:**
- Modify: `packages/client/ui-kira-teams/src/client/KiraTeamsDock.tsx`
- Modify: `packages/client/ui-kira-teams/src/client/locales.ts`
- Test: `packages/client/ui-kira-teams/tests/browser-plugin.client.spec.ts`

**Interfaces:**
- Produces: `agentRoleKeyOf(summary: SessionSummary): KiraTeamsKey`
- Produces: `activityKeyOf(summary: SessionSummary): KiraTeamsKey`
- Consumes: durable `summary.projectionValues.subagent.label`, `subagentActivity.phase`, `running`, and `pendingInteraction`.

- [ ] **Step 1: Confirm the red contract**

Run the package test and confirm `agentRoleKeyOf` / `activityKeyOf` are missing.

- [ ] **Step 2: Add locale vocabulary**

Add the exact shared keys `role.judge`, `role.researcher`, `role.agent`, `activity.preparing`, `activity.tools`, `activity.verifying`, `activity.waiting`, and `activity.done` to `zh`, `en`, and `es`.

- [ ] **Step 3: Implement minimal derivation**

`agentRoleKeyOf` reads the durable subagent label, normalizes it, maps judge/reviewer/quality vocabulary to `role.judge`, research/reference vocabulary to `role.researcher`, and otherwise returns `role.agent`. `activityKeyOf` maps pending → waiting, not-running → done, running-tools → tools, verifying → verifying, and all remaining active states → preparing.

- [ ] **Step 4: Render name, role, and action separately**

Change each member row so its accessible label and visible text contain the stable KIRA name, localized role, and localized current action. Do not expose provider/model internals.

- [ ] **Step 5: Run the focused KIRA browser-plugin spec**

Expected: role/action derivation tests pass with existing lineage tests unchanged.

### Task 2: Replace emoji cards with true SVG agent art

**Files:**
- Modify: `packages/client/ui-kira-teams/src/client/ModelActivityAvatar.tsx`
- Modify: `packages/client/ui-kira-teams/src/client/ModelActivityAvatar.module.css`
- Test: `packages/client/ui-kira-teams/tests/model-activity-avatar.client.spec.tsx`

**Interfaces:**
- Preserve: `agentAvatarKind(agentId: string): ModelAvatarKind`
- Preserve: `modelAvatarKind(model?: string): ModelAvatarKind`
- Produce: an `svg` child with `data-agent-glyph={true}` inside every rendered avatar.

- [ ] **Step 1: Confirm the red SVG test**

Run the avatar spec and confirm the current span-only avatar fails the `data-agent-glyph` SVG assertion.

- [ ] **Step 2: Add one internal SVG renderer**

Render a compact inline SVG using CSS-variable-driven stroke/fill. Select deterministic geometric marks by `ModelAvatarKind`; keep the public component/export surface unchanged.

- [ ] **Step 3: Remove emoji pseudo-content for agent kinds**

Delete/neutralize the emoji `content` rules for eagle/wolf/fox/owl/lynx/dolphin/forge/dragon so visual identity comes from the actual SVG.

- [ ] **Step 4: Preserve state animation**

Keep `data-avatar`, `data-phase`, and `data-state`; retain orbit/badge animations and the reduced-motion media rule.

- [ ] **Step 5: Run the avatar spec**

Expected: agent-id determinism, SVG presence, model fallbacks, and phase/state tests all pass.

### Task 3: Style the in-flow floating card and verify the package

**Files:**
- Modify: `packages/client/ui-kira-teams/src/client/KiraTeamsDock.module.css`
- Test: all `packages/client/ui-kira-teams/tests/*`

**Interfaces:**
- Preserve: `.root` participates in shell flex flow and reserves width.
- Produce: card shell with rounded surface, border/shadow, compact header, readable role/action hierarchy, mobile-safe width/height.

- [ ] **Step 1: Style `.dock` as a real Phoenix card**

Use semantic surface/border/text/accent variables, a restrained radius/shadow, bounded width, and internal scrolling while leaving `.root` in flow.

- [ ] **Step 2: Add row typography/layout classes**

Use a text stack beside the avatar: name primary, role secondary, current action tertiary/right-aligned as space permits. Keep hover/focus behavior compact.

- [ ] **Step 3: Verify responsive behavior in CSS contract**

Keep mobile width at 100%, bound height, and ensure rows do not force horizontal overflow.

- [ ] **Step 4: Run KIRA package tests and GUI rung**

Run the focused package tests first, then `pnpm run test:gui`. Record unrelated repo-wide failures separately rather than masking them.

- [ ] **Step 5: Commit the KIRA production changes**

Commit only the KIRA production/locales changes on the feature branch after tests prove the red contracts green.