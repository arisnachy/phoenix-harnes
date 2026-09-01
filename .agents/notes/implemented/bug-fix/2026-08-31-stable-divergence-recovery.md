# Agent Note: stable-channel divergence recovery

Status: implemented

English | [中文](2026-08-31-stable-divergence-recovery.zh.md)

## Problem

The promoted `stable` branch can have unrelated history after a deliberate release replacement. The updater treated that relation as an unsafe failure, and development checkouts hid the fact that a stable update was available.

## Decision

Classify the observed relation before choosing an updater action. A clean, managed `main` or `stable` checkout may replace unrelated release history only after the existing staging, locked-install, build, and smoke-test gates pass. Development branches and unmanaged checkouts remain protected. The watcher records `available` with the stable target on a development branch, so the UI can show the update without mutating that checkout. Restart activation accepts the same guarded replacement path and retains a recovery ref to the previous release.

## Alternatives considered

**Always fast-forward.** Rejected because unrelated release history cannot be fast-forwarded, leaving managed installations permanently unable to receive the promoted stable release.

**Reset every checkout to stable.** Rejected because development work and unmanaged local changes must never be overwritten automatically.

**Show only a paused state on development branches.** Rejected because it hides an actionable stable update from the app; the checkout remains protected while the update becomes visible.

## Consequences

Managed release installations can recover from a history replacement without a manual destructive reset, while previous history remains available through a recovery ref. Development and unmanaged checkouts still fail closed. The UI now has durable facts to render when stable advances, and no update card is shown when the checkout is current.

## Testing

The policy test passes 3/3 cases. A temporary stable checkout based on the previous published release detected the unrelated history, completed the full staging build and launcher smoke test, and finished at `updated/complete` on the promoted stable commit. TypeScript typecheck, focused updater/UI tests, syntax checks, and the documentation gates pass.
