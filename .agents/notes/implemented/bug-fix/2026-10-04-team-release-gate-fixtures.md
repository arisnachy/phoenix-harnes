# Agent Note: Restore release checks around Kira Team integration

Status: implemented

English | [中文](2026-10-04-team-release-gate-fixtures.zh.md)

## Problem

The Team integration validation exposed existing chat and host test fixtures that did not supply current projection, slot, child-option or attachment-limit contracts. The unchanged repository also exceeded its duplication threshold and had type-aware lint failures in connector and mail code, preventing a clean release check.

## Decision

Update the affected test fixtures to exercise the current contracts without weakening assertions. Share the two attachment publication paths through one private publisher in `packages/attachment/attachment-local/src/store.ts`, retaining atomic publication, failure cleanup and caller-owned cancellation. Remove type-proven redundant connector guards and call registry methods through their owning object. Await the existing mail identity lookup inside its cleanup boundary. Keep lint, coverage and duplication thresholds unchanged.

The vendor rescope gate excludes only `packages/client/ui-layout/src/client/service.ts` from the upstream `cordis` name match, alongside its existing stores and test exclusions: this literal identifies a workspace occupant, not an imported package. Keep unrelated package references checked. Make `SuperpowersSkillRecord` in `apps/cli/src/superpowers.ts` local because only the owning module uses it; this removes the unused export without changing runtime behavior.

## Alternatives considered

**Relax thresholds or skip failing tests.** This would hide existing release failures and weaken the integration evidence.

**Reopen earlier connector and mail features.** This would exceed the approved Team scope; only mechanical gate repairs and accurate fixtures are needed.

A structured child could also capture its final answer and then restart because a trailing denied call queued automatic failure-recovery input. Preserve the concluded state across scheduler barriers and suppress only this automatic recovery after conclusion; real user input remains independent. The existing terminal structured-output test exposes the failure, and adjacent scheduler tests verify ordinary recovery remains available.

## Consequences

These are bounded release-check repairs rather than a resumption of the earlier connector or mail feature work. Existing focused attachment, connector and mail tests validate their behavior; the Team and host suites retain their actual chat, routing and delivery assertions. The original duplicate count is recorded in `/tmp/phoenix-orquesta-duplication-head.log`; the extracted publisher reduces duplicated lines instead of adding an exclusion.
