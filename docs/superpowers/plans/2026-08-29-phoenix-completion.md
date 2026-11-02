# PHOENIX Completion Implementation Plan

English | [中文](2026-08-29-phoenix-completion.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the persistent, self-recovering PHOENIX mission workflow, expose the remaining Hermes-style operator controls, verify the web quota surface, and publish the verified branch without claiming unverified connector behavior.

**Architecture:** Keep the session log authoritative. Persist supervisor intent, strategy choices, retry/undo records, and judge feedback as bounded typed events; reconstruct process state on startup and require explicit authority before resuming work that can mutate a workspace. Reuse the existing command registry, profile boot, Codex plugin bridge, MCP registry, and Playwright fixtures instead of adding parallel control paths.

**Tech Stack:** TypeScript, Cordis services, SQLite/JSONL session persistence, Vitest, Playwright, pnpm, GitHub CLI.

**Spec:** User request in the active task: complete supervisor persistence/recovery, alternative strategy selection, retry/undo/doctor/config/update, e2e connector checks, quota visual verification, and authorized GitHub publication/promotion.

## Global Constraints

- Phoenix-owned packages use `@phoenix-ai/*`; vendored Cordis identities remain explicit upstream dependencies.
- Model-visible state is logged and reconstructable from the session event stream.
- Retries and strategy changes are bounded by validated configuration and never silently bypass permissions.
- Workspace mutation after restart requires an explicit resume authority recorded by the goal tool.
- Secrets remain in environment variables and never enter logs, snapshots, commits, or command output.
- `main` and `stable` are promoted only after the outgoing SHA, local gates, remote checks, and merge result are verified.

### Task 1: Durable mission supervisor state

**Files:**
- Modify: `packages/goal/goal/src/domain.ts`, `packages/goal/goal/src/types.ts`, `packages/goal/goal/src/fold.ts`
- Modify: `packages/goal/goal/src/index.ts`, `packages/goal/tool-goal/src/index.ts`
- Create: `packages/goal/goal-round-driver/src/supervisor.ts`
- Modify: `packages/goal/goal-round-driver/src/index.ts`
- Test: `packages/goal/goal-round-driver/tests/supervisor.spec.ts`
- Update: `docs/persistence-catalog.md`, goal READMEs, and a same-PR Agent Note

**Interfaces:**
- `goal/supervisor` records `{ goalId, revision, status, nextAction, attempts, lastError? }` with bounded fields.
- `GoalSupervisor` exposes `restore(session)`, `checkpoint(session, state)`, and `resumeAfterHumanApproval(agent, ref)`.
- The driver reconstructs active supervisor state after `agent/session-start`, leaves it disarmed, and resumes only after the exact `update_goal resume` authority edge.

- [ ] Add a failing replay test for a persisted active supervisor after a new process context is mounted.
- [ ] Add a failing authority test proving restart restoration does not enqueue a workspace-mutating round before explicit resume.
- [ ] Implement the typed event, decoder, fold, checkpoint writer, and driver restoration path.
- [ ] Run `pnpm exec vitest run packages/goal/goal-round-driver/tests/supervisor.spec.ts packages/goal/tool-goal/tests/tool-goal.spec.ts`.
- [ ] Regenerate the persistence catalog and update the English/Chinese package docs.
- [ ] Commit as `feat: persist mission supervisor state`.

### Task 2: Formal strategy registry and bounded selection

**Files:**
- Create: `packages/goal/goal-round-driver/src/strategy.ts`
- Modify: `packages/goal/goal/src/domain.ts`, `packages/goal/goal-round-driver/src/prompt.ts`, `packages/goal/goal-round-driver/src/index.ts`
- Test: `packages/goal/goal-round-driver/tests/strategy.spec.ts`, `packages/goal/goal-round-driver/tests/goal-round-driver.spec.ts`
- Update: goal-round-driver READMEs and Agent Note

**Interfaces:**
- `GoalStrategyId` is a closed union of `baseline`, `verification-first`, `alternate-tool`, and `minimal-change`.
- `selectNextStrategy(previous, failedRounds)` returns a deterministic bounded strategy and never repeats the immediately preceding strategy.
- `goal/strategy` records the selected strategy and reason before its prompt is admitted.

- [ ] Write failing tests for deterministic rotation, exhausted strategy capacity, and durable replay.
- [ ] Implement selection and event recording through the existing session append API.
- [ ] Include the selected strategy and prior judge findings in the canonical prompt.
- [ ] Run focused driver, invariant, and judge tests.
- [ ] Commit as `feat: record bounded goal strategies`.

### Task 3: Hermes-style operator controls

**Files:**
- Modify: `packages/interaction/commands/src/index.ts` and command presentation tests
- Create or modify: `apps/cli/src/doctor.ts`, `apps/cli/src/config-command.ts`, `apps/cli/src/update-command.ts`
- Modify: `apps/cli/src/args.ts`, `apps/cli/src/bin.ts`, and built-bin tests
- Modify: retry/undo session packages and their existing snapshots only where the authoritative event API is already present
- Update: CLI reference documentation and Agent Note

**Interfaces:**
- `dsh doctor` prints structured PASS/WARN/FAIL checks without secrets.
- `dsh config` delegates to the existing boot-free config dump and supports a JSON output flag.
- `dsh update` invokes the existing managed updater with a dry-run default and an explicit apply flag.
- `/retry` and `/undo` resolve the latest durable turn/retry records and append a new recovery event; they never delete history.

- [ ] Add failing parser and built-bin tests for each command and invalid arguments.
- [ ] Implement the CLI dispatch and command handlers using existing profile/home path helpers.
- [ ] Add durable retry/undo recovery records and snapshots.
- [ ] Run the owning unit tests and built-bin smoke.
- [ ] Commit as `feat: add Phoenix operator controls`.

### Task 4: Connector and plugin e2e inventory

**Files:**
- Modify: `apps/cli/tests/built-bin.e2e.ts`, `apps/cli/tests/memory-mcp-configs.spec.ts`
- Create: `scripts/verify-live-connectors.mjs` and its redacted report fixture
- Modify: MCP registry/connector tests only for discovered regressions
- Update: connector verification documentation and Agent Note

**Interfaces:**
- Keyless tests verify every composed plugin and MCP adapter loads, registers its declared service, and fails closed when credentials are absent.
- Credentialed tests run only when the documented provider environment variables exist; reports contain provider names, status, and duration but never values or tokens.
- The report distinguishes `PASS`, `SKIPPED_NO_CREDENTIAL`, and `FAIL`.

- [ ] Add a keyless plugin/MCP composition inventory test.
- [ ] Add credential-gated connector smoke tests for available providers.
- [ ] Run the inventory and the credentialed suite when credentials are present; record skipped providers explicitly.
- [ ] Commit as `test: inventory plugin and MCP connector health`.

### Task 5: Visual quota verification

**Files:**
- Modify: `packages/client/ui-model-selection/src/client/CodexQuotaRemaining.tsx` and its CSS/tests
- Modify: `apps/web/tests/models-settings.e2e.ts` or create a focused quota visual e2e fixture
- Create: a deterministic quota visual snapshot with redacted telemetry values

**Interfaces:**
- The Settings-adjacent surface renders 5-hour and 7-day remaining percentages plus reset countdowns.
- Loading, unavailable telemetry, and zero-remaining states are distinct and accessible.

- [ ] Add a failing browser assertion for both windows, labels, and reset countdowns.
- [ ] Run the focused Playwright test and capture a screenshot/snapshot.
- [ ] Commit as `test: verify Codex quota presentation`.

### Task 6: Pre-push, publish, and promotion

**Files:**
- No source changes unless a preceding gate finds a real defect.
- Update release/Agent Note documentation only when the exact published SHA is known.

- [ ] Run `pnpm run change-scope --base origin/stable` and inspect the complete outgoing scope.
- [ ] Run focused tests, `pnpm run build`, `pnpm run hygiene`, and `pnpm run doc-sync` according to the outgoing diff.
- [ ] Push the feature branch and verify remote SHA equality.
- [ ] Open or update a PR against the verified base and wait for required GitHub checks.
- [ ] Merge-forward to `stable`, verify the merge SHA and checks, then promote the same verified commit to `main` only when the remote policy permits it.
- [ ] Report exact local SHA, remote branch SHAs, checks, skipped credentialed connectors, and any LIVE verification limits.

---

## Self-review

The plan covers each requested phase. It deliberately keeps credential-dependent connector checks conditional and makes the difference between keyless composition proof and authenticated provider proof explicit. It also preserves the existing restart safety rule: persistence restores mission state, but authority to resume mutation remains an explicit human action.
