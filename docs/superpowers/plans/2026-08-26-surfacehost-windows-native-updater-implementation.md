# SurfaceHost + Windows Native Automation + Restart-Safe Updater Implementation Plan

> Branch: `feat/surfacehost-windows-native-update`
> Design: `docs/superpowers/specs/2026-08-26-surfacehost-windows-native-updater-design.md`

## Goal

Ship one Windows-safe PHOENIX release that (1) shows documents/artifacts/miniapps inside chat through a typed SurfaceHost, (2) lets HARDNESS-aware agents handle common native Windows dialogs semantically, and (3) activates prepared stable updates by restarting the supervised Host automatically instead of printing a manual restart message.

## Execution order

The updater is implemented first because it owns process lifetime. Windows native automation is second because it extends the security boundary. SurfaceHost is third because it is a UI/runtime capability built on existing stable slots.

## Task 1 — RED updater lifecycle regressions

**Files**
- inspect existing updater/supervisor tests under `scripts/**/*.test.*`, `scripts/**/*.spec.*`, and `apps/cli/src/**/*.spec.ts`
- add or extend the nearest existing updater contract tests

**Required failing assertions before implementation**
1. successful watched staging produces `.phoenix-auto-update/runtime/phoenix-update-restart-request.json` for the prepared target;
2. successful watched staging does not emit `Restart PHOENIX to activate it`;
3. supervised CLI mode does not start the in-host updater watcher;
4. supervisor observes a restart request while Host is alive, requests graceful Host shutdown, activates once, and launches exactly one replacement Host.

## Task 2 — GREEN updater handoff

**Files**
- `scripts/phoenix-auto-update.mjs`
- `scripts/phoenix-windows-supervisor.mjs`
- `apps/cli/src/bin.ts`
- updater/supervisor tests

**Implementation**
- write the restart request only after preparation + smoke succeeds;
- change prepared-state messaging to automatic activation language and remove the legacy manual-restart string;
- set `PHOENIX_UPDATE_SUPERVISED=1` on the supervised Host child;
- skip `startPhoenixUpdateWatcher()` in `bin.ts` when supervised;
- monitor restart-request while Host is running;
- on request, gracefully terminate Host, bounded-wait, fallback terminate if necessary, stop updater watcher, activate prepared candidate, and loop to a fresh Host;
- preserve rollback/recovery behavior and prevent duplicate activation.

**Verification**
- targeted updater/supervisor tests
- `pnpm run typecheck`
- updater static contract tests

## Task 3 — RED Windows-native dialog capability tests

**Files**
- inspect HARDNESS/sandbox tool registration and browser automation packages
- create the smallest adjacent package/module for Windows dialog automation
- fake adapter tests first

**Required failing assertions**
1. classify Open / Save As / Folder Picker / Confirmation dialogs semantically;
2. enumerate controls by semantic identity;
3. stale window/control IDs fail closed;
4. file selection invokes HARDNESS path validation before changing a dialog;
5. protected runtime/credential paths are denied;
6. no coordinate-click fallback exists;
7. unsupported non-Windows host reports unavailable without side effects.

## Task 4 — GREEN Windows Native Automation

**Implementation**
- introduce a UI Automation adapter backed by PowerShell/.NET only on Windows;
- expose semantic operations: list, inspect, setValue, invoke, selectFile, confirm;
- register tool/capability through existing tool plumbing;
- route path-bearing operations through existing HARDNESS path policy;
- enforce bounded timeout and stable identity checks;
- return structured errors to the model.

**Windows integration smoke**
- `windows-latest` fixture opens a deterministic PowerShell/WinForms file dialog or equivalent standard dialog;
- inspect it semantically and perform one non-destructive interaction;
- verify no cross-window action after fixture closes.

## Task 5 — RED Surface descriptor and host tests

**Files**
- inspect `packages/client/ui-attachment`, `ui-tool`, `ui-deliverables`, `ui-conversation`
- introduce a focused surface contract package/module following current package conventions

**Required failing assertions**
1. valid image/PDF/text/app descriptors parse; malformed descriptors reject;
2. unsupported MIME resolves to safe fallback;
3. generated supported image is auto-presented;
4. tool/model-requested descriptor can be opened inline and expanded;
5. miniapp uses a restrictive iframe sandbox and rejects invalid bridge messages;
6. trivial text/tool result does not auto-open a surface.

## Task 6 — GREEN SurfaceHost

**Implementation**
- add serializable `SurfaceDescriptor` contract and registry;
- add renderers for image, PDF, text/Markdown/code, JSON, app, fallback;
- integrate active surface state into `ui-conversation`;
- emit/open descriptors from attachments, tool results, and deliverables;
- preserve explicit external-open fallback;
- add model-facing presentation guidance to the system prompt without forcing surfaces for ordinary answers;
- keep miniapps data-only and iframe-sandboxed; no React/DOM injection from model output.

## Task 7 — Integration and adversarial checks

Run on exact branch head:

- targeted updater tests
- targeted Windows dialog unit tests
- targeted SurfaceHost/UI tests
- existing HARDNESS adversarial suite relevant to path policy
- `pnpm run typecheck`
- `pnpm run check:ci:static`
- `pnpm run build`
- `pnpm run check:ci:windows-blocking`
- Windows native integration smoke
- `git diff --check`

Security checks:
- model-generated app cannot access PHOENIX origin/storage directly;
- native dialog tool has no coordinate click primitive;
- path policy denial happens before UI mutation;
- updater never requests restart for a failed/un-smoked candidate;
- only one updater watcher exists in supervised Windows mode.

## Task 8 — PR, exact-SHA verification, release

- open PR from `feat/surfacehost-windows-native-update` to `main`;
- verify changed-file inventory and final CI on exact head SHA;
- merge only after Windows-relevant gates are green;
- verify exact merged `main` SHA;
- update `stable` to that exact SHA;
- update `.phoenix/channel/stable.json` on `phoenix/update-channel` to the same SHA;
- verify `main == stable == channel target`;
- verify updater no longer emits manual restart message and the supervised launch path receives the new build.
