# Agent Note: Restore release checks around Kira Team integration

Status: implemented

English | [中文](2026-10-04-team-release-gate-fixtures.zh.md)

## Problem

The Team integration validation exposed existing chat and host test fixtures that did not supply current projection, slot, child-option or attachment-limit contracts. The unchanged repository also exceeded its duplication threshold and had type-aware lint failures in connector and mail code, preventing a clean release check.

## Decision

Update the affected test fixtures to exercise the current contracts without weakening assertions. Share the two attachment publication paths through one private publisher in `packages/attachment/attachment-local/src/store.ts`, retaining atomic publication, failure cleanup and caller-owned cancellation. Remove type-proven redundant connector guards and call registry methods through their owning object. Await the existing mail identity lookup inside its cleanup boundary. Keep lint, coverage and duplication thresholds unchanged.

The vendor rescope gate excludes only `packages/client/ui-layout/src/client/service.ts` from the upstream `cordis` name match, alongside its existing stores and test exclusions: this literal identifies a workspace occupant, not an imported package. Keep unrelated package references checked. Make `SuperpowersSkillRecord` in `apps/cli/src/superpowers.ts` local because only the owning module uses it; this removes the unused export without changing runtime behavior.

The browser Cordis fixture retains its manual approval lifecycle through a test-only definition adapter that sets `autoApprove: false` and restores the original method on disposal. The advanced ACP and headless fixtures follow the current production auto-authorization policy, including their real running/activation receipts. Main commit `b075e3a33e` changed the production `cordis_define` and `cordis_run` tool descriptions, so those two ACP header descriptions and their system-prompt copies, plus the matching policy sentence, follow the current prose; the advanced goldens reflect that explicit automatic-policy scenario while the browser still proves the manual approval boundary. The product headless profile golden also records the new durable default `agent/model-selection` event and adjusts its three source-event references, retaining the tool round trip and original runtime-context text. Its keyless CLI-mock overlay disables only the unrelated native `subagent-codex` account probe, so success and model-failure assertions remain deterministic without real-account setup.

The remaining owning fixtures distinguish instruction and time-context messages from other plugin messages, pin absent project markers, and check the stable identity opener instead of duplicated policy prose. The pi-ai fixtures include the registered offline/free providers, explicitly declare the experimental vision model, decode compressed request bodies before asserting the wire contract, and mock catalog discovery for registration/disposal. Windows runtime discovery stays explicitly verified while automatic configuration follows the actual host platform. Restore the missing stylesheet imported by the existing GenerativeUi component so its owning tests can load; this does not add a new UI integration.

## Alternatives considered

**Relax thresholds or skip failing tests.** This would hide existing release failures and weaken the integration evidence.

**Reopen earlier connector and mail features.** This would exceed the approved Team scope; only mechanical gate repairs and accurate fixtures are needed.

A structured child could also capture its final answer and then restart because a trailing denied call queued automatic failure-recovery input. Preserve the concluded state across scheduler barriers and suppress only this automatic recovery after conclusion; real user input remains independent. The existing terminal structured-output test exposes the failure, and adjacent scheduler tests verify ordinary recovery remains available.

## Consequences

These are bounded release-check repairs rather than a resumption of the earlier connector or mail feature work. Existing focused attachment, connector and mail tests validate their behavior; the Team and host suites retain their actual chat, routing and delivery assertions. The original duplicate count is recorded in `/tmp/phoenix-orquesta-duplication-head.log`; the extracted publisher reduces duplicated lines instead of adding an exclusion.
