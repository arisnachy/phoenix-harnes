# Agent Note: Protected updater pauses stay quiet and quota sits inline

Status: implemented

English | [中文](2026-09-12-protected-update-pauses-and-inline-quota.zh.md)

## Problem

The stable updater records a paused state when a local checkout is protected from automatic history changes, including a development branch, divergent history, an ahead checkout, or a foreign remote. Rendering every paused state as a sidebar action presents repository protection as an update error and offers a retry that cannot change the protected checkout.

The Codex quota footer uses a rounded container, gradients, shadows, circular meters, and separate primary and secondary accent colors. That treatment separates the quota from the Settings row instead of making the limits part of the same window.

## Decision

`isHiddenUpdaterPause` in `packages/client/ui-settings-plugin-inventory/src/client/update-presentation.ts` identifies the five policy-only updater phases. `updateLabelKey` uses it while retaining the existing detail-based development-branch guard. Operational pauses without those phases remain visible, and `error` plus `rollback-failed` remain visible with their retry behavior.

`CodexQuotaRemaining.module.css` renders both quota windows inline with the Settings footer. The root has no background, border, radius, or shadow; meters and reset text use the Settings label tokens; and primary and secondary windows share the same neutral token. The two windows, reset countdowns, accessible labels, and responsive spacing remain intact.

## Alternatives considered

**Clear policy-paused state in the updater.** Rejected: the durable state remains useful for diagnostics and the updater must continue to protect unmanaged checkouts from destructive replacement.

**Show every paused state with a retry action.** Rejected: a retry is meaningful for an operationally blocked update, not for a branch, history, or remote policy decision.

**Keep circular quota meters but recolor them neutrally.** Rejected: the circular meter is still a separate visual badge; inline text keeps the quota inside the Settings footer without a competing surface.

## Consequences

Protected local checkouts no longer create a persistent actionable alert in the Settings footer, while real preparation, activation, rollback, and transport failures retain their existing user-facing behavior. The updater's automatic retry and safe activation rules are unchanged.

Quota values use the same label hierarchy as Settings and consume less visual emphasis and chrome. The existing quota data attributes and accessible group/window labels remain available to tests and assistive technology.

## Testing

The pure presentation and CSS regressions run with Vitest's single-thread pool: 3 tests pass. The focused React suites pass 59 tests, including protected pause classification, quota windows, reset countdowns, provider filtering, and retry behavior.
