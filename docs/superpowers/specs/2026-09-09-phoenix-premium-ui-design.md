# PHOENIX Premium UI Refresh — Design

Date: 2026-09-09
Status: Approved direction; implementation pending final spec review

## Goal

Make PHOENIX feel like a finished premium AI product rather than a technical dashboard. Adopt the interaction density and visual calm of ChatGPT/Codex without copying their UI literally, while preserving PHOENIX identity and existing runtime behavior.

## Non-negotiable behavior

Visual work must not change the core mission/runtime semantics. In particular:

- the composer must always remain writable whenever the current session is writable;
- switching or creating sessions must never create a transient inert composer;
- opening previews, tools, logs, or a right-side surface must not pause or end the active mission;
- tool/activity presentation is a projection of existing runtime state, not a new source of truth;
- all controls remain keyboard-accessible and usable in light and dark modes.

## Visual language

PHOENIX uses a restrained monochrome-first system with the existing PHOENIX mark as the identity anchor. Surfaces use subtle elevation, low-contrast borders, compact spacing, and short 120–180 ms transitions. Permanent boxes are avoided when a simple row, hover state, or popover is enough.

## Phase 1 — Shell, composer, and activity

### Sidebar

- Keep the compact New Session row already introduced.
- Make session rows borderless and compact, with a quiet active background.
- Show secondary actions only on hover/focus (`…`).
- Group sessions by recency where existing data supports it: Today, Yesterday, Last 7 days, Older.
- Reduce metadata prominence and keep PHOENIX branding visually calm.

### Top bar

- Reduce the permanent toolbar to product/context title, compact model/status control, and only essential actions.
- Move secondary configuration into popovers rather than persistent controls.

### Composer

- Preserve the current `InputBar` input machine and submission contracts.
- Restyle the existing composer as a floating capsule/card with softer border/elevation and clearer hierarchy.
- Keep `+` / attachments on the left and model, voice, Send/Stop on the right.
- A running mission may display a compact `Working · elapsed` state without replacing or disabling the editable textarea when follow-up input is allowed.
- Focus, selection, IME, paste/cut, attachment, voice, queue/steer, and Safari behavior must remain covered by existing tests.

### Agent activity / tool calls

- Render routine operations as compact one-line activity rows such as `Read 4 files`, `Ran tests`, `Editing service.ts`.
- Completed rows collapse by default; active or failed rows remain prominent enough to understand progress.
- Expanded rows expose the existing technical detail; no diagnostic data is discarded.
- Human-readable progress labels are presentation aliases over existing activity/tool state, not invented model events.

## Phase 2 — Contextual right panel

Introduce a reusable right-side workspace surface that can show supported artifacts while the conversation continues:

- browser/web preview;
- image/design preview;
- document/slides preview when available;
- code diff/file view;
- terminal/log output;
- Computer Use visual state.

The panel is resizable and collapsible. Opening/closing it is UI state only and cannot pause the mission. Content providers register through a small surface contract so the conversation runtime does not depend on individual viewers.

## Phase 3 — Polish and navigation

- Command palette (`Ctrl/Cmd+K`) for New Session, workspace/project navigation, model switching, Computer Use, and settings.
- Compact usage indicator with detail-on-demand.
- Toast system for transient update/reconnect/save/error notices.
- Consistent monochrome PHOENIX favicon/brand asset use across sidebar, PWA, and README where appropriate.
- Refined charcoal dark mode and balanced light mode.
- Motion limited to meaningful state changes and respecting reduced-motion preferences.

## Architecture boundaries

1. **Runtime remains authoritative.** UI packages consume current session, input, tool, model, and activity contracts.
2. **No composer rewrite.** `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` keeps its input machine wiring; Phase 1 should primarily change composition and CSS, with behavior changes only when tests prove necessary.
3. **Sidebar changes remain within sidebar/session presentation.** New Session continues through `WorkspaceRuntime.startSession` and must preserve the composer-lock regression fix.
4. **Right panel is isolated.** It receives declarative surface descriptors and exposes open/close/resize UI state; it does not own mission execution.
5. **Progress aliases are deterministic.** Mapping technical tool/activity state to friendly labels must be testable and fall back to raw labels for unknown operations.

## Test strategy

### Required regression gates

- New Session keeps a writable composer until direct hand-off to the replacement session.
- Ordinary typing updates the controlled draft after sidebar/session operations.
- Existing `input-bar`, input-machine, IME, paste/cut, voice, attachments, queue, and submission tests remain green.
- Sidebar keyboard navigation and hover-only controls remain accessible by focus.
- Tool rows preserve full detail when expanded.
- Right panel open/close/resize does not alter session running state or composer writability.
- Reduced-motion and light/dark visual-state selectors have deterministic tests where practical.

### Integration order

Each phase lands on `main` first through a focused branch/PR and full relevant CI. After verification, the same logical change is ported independently to `stable`; `main` and `stable` are not wholesale-merged because their histories are intentionally divergent.

## Delivery slices

1. **UI-1:** sidebar/session visual cleanup + top-bar simplification.
2. **UI-2:** composer premium restyle, no input-machine rewrite.
3. **UI-3:** compact agent/tool activity rows.
4. **UI-4:** contextual right panel contract + first viewers.
5. **UI-5:** command palette, usage popover, toasts, theme/motion polish.

Each slice must be independently releasable and must not ship if it breaks session creation, typing, or mission continuity.
