# PHOENIX Cognitive Runtime Foundation Implementation Plan

English | [中文](2026-09-12-cognitive-runtime-foundation-plan.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, read-only cognitive projection that derives attention, bounded working memory, and a global workspace from PHOENIX's existing session-learning records.

**Architecture:** Extend `dsh-session-learning` with one bounded per-session read used by a new `dsh-cognitive-runtime` service under the existing `packages/session` group. Keep attention, partitioning, and snapshot construction pure; let the Cordis service own only lifecycle, session lookup, refresh serialization, and last-successful-state retention. Mount the service after `session-learning` in `dsh-base` without adding model context or durable event types.

**Tech Stack:** TypeScript ESM workspace packages, Cordis `Service`, Schemastery configuration, Vitest, YAML bundle composition, generated documentation catalogs.

**Spec:** [`2026-09-12-cognitive-runtime-foundation-design.md`](../specs/2026-09-12-cognitive-runtime-foundation-design.md)

## Global Constraints

- The raw session log remains canonical; no new `SessionEventMap` member is added.
- `session-learning` remains the only cognitive-memory authority; the new service only reads its bounded records.
- Attention ranking uses persisted timestamps and stable tie-breaks; it never calls `Date.now()`, randomness, process order, or an LLM.
- The service is read-only and cannot grant permissions, execute tools, mutate goals, or alter `agent-loop`.
- Every new package has package README, invariant companion, strict TypeScript, and focused 100% source coverage.
- Existing dirty checkouts and unrelated auth/voice changes remain untouched; all edits happen in `codex/cognitive-runtime-foundation`.

---

### Task 1: Add bounded per-session cognitive-memory access

**Files:**
- Modify: `packages/session/session-learning/src/index.ts`
- Modify: `packages/session/session-learning/tests/service.spec.ts`
- Modify: `packages/session/session-learning/README.md`
- Modify: `packages/session/session-learning/README.zh.md`

**Interfaces:**
- Consumes: existing `CognitiveMemoryLedger.timeline()` and branded `SessionId`.
- Produces: `LearningMemoryService.cognitiveForSession(sessionId: SessionId, limit?: number): CognitiveMemoryRecord[]`, returning active records for exactly one session, ordered by persisted occurrence and bounded by `limit`.

- [ ] **Step 1: Write the failing test**

Add a service test that creates two sessions, records events in both, calls `cognitiveForSession()` with a small limit, and asserts only the requested session's active records are returned in deterministic order. Assert a non-positive, fractional, and over-limit request rejects or throws according to the package's existing validation style.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm exec vitest run packages/session/session-learning/tests/service.spec.ts`

Expected: FAIL because `cognitiveForSession` is not defined.

- [ ] **Step 3: Implement the bounded read**

Add a documented method that validates a positive safe-integer limit, calls `this.cognitive.timeline({ sessionId: String(sessionId), includeHistory: false })`, and returns the newest `limit` records while preserving chronological order. Do not apply the service's current-project default to this method; the caller already supplies the exact session identity.

- [ ] **Step 4: Update the consumer documentation**

Document that the method is a read-only, session-scoped projection read and does not replace the canonical session archive. Mirror the short contract in the Chinese README and regenerate its pairing metadata if the repository gate requires it.

- [ ] **Step 5: Run the focused test and commit**

Run: `pnpm exec vitest run packages/session/session-learning/tests/service.spec.ts packages/session/session-learning/tests/cognitive.spec.ts`

Expected: PASS. Commit with `feat(cognition): expose bounded session memory reads`.

---

### Task 2: Implement pure attention and working-memory projection

**Files:**
- Create: `packages/session/cognitive-runtime/src/types.ts`
- Create: `packages/session/cognitive-runtime/src/attention.ts`
- Create: `packages/session/cognitive-runtime/src/working-memory.ts`
- Create: `packages/session/cognitive-runtime/src/workspace.ts`
- Create: `packages/session/cognitive-runtime/tests/attention.spec.ts`
- Create: `packages/session/cognitive-runtime/tests/working-memory.spec.ts`

**Interfaces:**
- Consumes: `CognitiveMemoryRecord` values from `dsh-session-learning`.
- Produces: `AttentionWeights`, `AttentionCandidate`, `WorkingMemoryPartition`, `CognitiveState`, `scoreAttention()`, `partitionWorkingMemory()`, and `createGlobalWorkspace()`.

- [ ] **Step 1: Write deterministic scorer tests**

Cover importance/confidence/recency, pending/error urgency, mission/prospective goal relevance, frequency-based novelty, configured weights, persisted-time-only scoring, and tie-breaking by `eventSeq`, `provenance.sourceUri`, then `id`.

- [ ] **Step 2: Run the pure tests to verify they fail**

Run: `pnpm exec vitest run packages/session/cognitive-runtime/tests/attention.spec.ts packages/session/cognitive-runtime/tests/working-memory.spec.ts`

Expected: FAIL because the new source modules do not exist.

- [ ] **Step 3: Implement the pure projection**

Implement signal extraction and weighted normalization without ambient time. Build detached candidate values, sort once with the stable comparator, select one focus candidate, fill active/background budgets, and classify the remainder as budget-suppressed. Keep forgotten, superseded, and obsolete records out of active candidates.

- [ ] **Step 4: Add edge-case tests**

Assert empty input, equal timestamps, zero optional budgets, all records filtered, finite scores, and that changing the input array after projection cannot mutate the returned snapshot.

- [ ] **Step 5: Run the pure tests and commit**

Run: `pnpm exec vitest run packages/session/cognitive-runtime/tests/attention.spec.ts packages/session/cognitive-runtime/tests/working-memory.spec.ts --coverage --coverage.include='packages/session/cognitive-runtime/src/attention.ts' --coverage.include='packages/session/cognitive-runtime/src/working-memory.ts' --coverage.include='packages/session/cognitive-runtime/src/workspace.ts'`

Expected: PASS with 100% coverage for the selected source files. Commit with `feat(cognition): add deterministic attention workspace projection`.

---

### Task 3: Add the Cordis cognitive-runtime service

**Files:**
- Create: `packages/session/cognitive-runtime/package.json`
- Create: `packages/session/cognitive-runtime/tsconfig.json`
- Create: `packages/session/cognitive-runtime/src/index.ts`
- Create: `packages/session/cognitive-runtime/src/invariant.ts`
- Create: `packages/session/cognitive-runtime/tests/service.spec.ts`
- Create: `packages/session/cognitive-runtime/tests/invariant.spec.ts`

**Interfaces:**
- Consumes: `ctx.sessions`, `ctx.learningMemory`, pure projection functions, `session/created`, and `session/event`.
- Produces: `ctx.cognitiveRuntime.get(sessionId)`, `refresh(sessionId)`, `ready()`, and resolved read-only `config`.

- [ ] **Step 1: Write service lifecycle tests**

Use a real `Context` with `SessionStore`, `LearningMemoryService`, and the new service. Assert existing sessions are reconstructed after startup, relevant event appends refresh the snapshot, `assistant/chunk` does not refresh it, duplicate delivery is harmless, missing sessions return `undefined`, and a failed refresh retains the previous snapshot while later refreshes still work.

- [ ] **Step 2: Run the service tests to verify they fail**

Run: `pnpm exec vitest run packages/session/cognitive-runtime/tests/service.spec.ts packages/session/cognitive-runtime/tests/invariant.spec.ts`

Expected: FAIL because the package and service do not exist.

- [ ] **Step 3: Implement package configuration and exports**

Use the existing session package manifest pattern with `@phoenix-ai/dsh-cognitive-runtime`, peer/dev dependencies on Cordis, invariants, session, session-learning, and schemastery, and explicit ESM exports. Add strict `tsconfig.json` references to the same source packages.

- [ ] **Step 4: Implement lifecycle ownership**

Use `static inject = ['sessions', 'learningMemory']`. Seed current sessions, subscribe to `session/created` and only relevant durable events, serialize refreshes through one operation tail, await `learningMemory.ready()`, and update the state map only after a successful pure projection. Catch refresh failures, warn through the host logger, and retain the previous state. Register the package invariant through `ctx.invariants` and assert that returned snapshots have the requested session identity and bounded item counts.

- [ ] **Step 5: Run service coverage and commit**

Run: `pnpm exec vitest run packages/session/cognitive-runtime/tests/service.spec.ts packages/session/cognitive-runtime/tests/invariant.spec.ts --coverage --coverage.include='packages/session/cognitive-runtime/src/**/*.ts'`

Expected: PASS with 100% coverage for executable package source. Commit with `feat(cognition): add replayable cognitive runtime service`.

---

### Task 4: Register the package and mount the read-only service

**Files:**
- Modify: `tsconfig.host.json`
- Modify: `packages/bundle/base/package.json`
- Modify: `packages/bundle/base/cordis.patch.yml`
- Modify: `packages/bundle/base/tests/base.spec.ts`

**Interfaces:**
- Consumes: built package manifest and Cordis service registration.
- Produces: a base-bundle row named `cognitive-runtime` loaded after `session-learning`, with no prompt, tool, permission, or durable-event contribution.

- [ ] **Step 1: Add the host project reference and base dependency**

Insert the new package reference adjacent to `session-learning` and add `@phoenix-ai/dsh-cognitive-runtime: workspace:^` to the base bundle dependencies.

- [ ] **Step 2: Add the base patch row**

Insert the `cognitive-runtime` service immediately after the `session-learning` row. Keep its config explicit and bounded; do not add an opt-in prompt consumer or any API key/config secret.

- [ ] **Step 3: Extend the bundle composition test**

Assert the parsed base patch contains exactly one `cognitive-runtime` row and that its position follows `session-learning`. Assert the row has no `disabled`, `tools`, or permission configuration.

- [ ] **Step 4: Run composition checks and commit**

Run: `pnpm exec vitest run packages/bundle/base/tests/base.spec.ts packages/session/cognitive-runtime/tests/service.spec.ts`; then run `pnpm run verify-cordis-config`.

Expected: PASS. Commit with `feat(bundle): mount cognitive runtime foundation`.

---

### Task 5: Document the shipped decision and run repository gates

**Files:**
- Create: `packages/session/cognitive-runtime/README.md`
- Create: `packages/session/cognitive-runtime/README.zh.md`
- Create: `packages/session/cognitive-runtime/README.i18n.yaml`
- Create: `.agents/notes/implemented/architecture/2026-09-12-cognitive-runtime-foundation.md`
- Create: `.agents/notes/implemented/architecture/2026-09-12-cognitive-runtime-foundation.zh.md`
- Create: `.agents/notes/implemented/architecture/2026-09-12-cognitive-runtime-foundation.i18n.yaml`
- Regenerate: generated config and API catalogs owned by `doc-sync`.

**Interfaces:**
- Consumes: the implemented package and the approved design.
- Produces: maintainer documentation that states current ownership, deterministic replay, no prompt effect, boundedness, failure retention, and deferred consumers.

- [ ] **Step 1: Write the package README and implemented Agent Note**

Describe composition, config, service methods, scoring semantics, failure behavior, no model-visible effect, and deferred work. The Agent Note must use the implemented format with `Problem`, `Decision`, `Alternatives considered`, and `Consequences`; record why a new durable event bus, direct `agent-loop` changes, and an LLM attention scorer were rejected.

- [ ] **Step 2: Run documentation generation and checks**

Run: `pnpm run doc-sync`; inspect generated diffs; then run `git diff --check`.

Expected: no stale catalog, pairing, link, or prose-budget errors.

- [ ] **Step 3: Run the relevant outgoing checks**

Run: `pnpm run change-scope --base origin/main`; `pnpm run typecheck`; `pnpm run lint`; `pnpm run build`; `pnpm run hygiene`; and the focused cognitive, session-learning, and base-bundle tests from Tasks 1–4.

Expected: all selected checks pass; any platform-specific skip is recorded with the exact command and reason.

- [ ] **Step 4: Commit documentation and validation-ready source**

Commit with `docs(cognition): document runtime foundation` only after inspecting the generated files and the complete diff.

---

### Task 6: Publish with exact SHA evidence

**Files:**
- Git refs only after all local checks pass.

- [ ] **Step 1: Verify the clean feature worktree and record `HEAD`**

Run: `git status --short --branch`; `git rev-parse HEAD`; `git rev-parse origin/main origin/stable`.

- [ ] **Step 2: Push the feature branch normally**

Run: `git push -u origin codex/cognitive-runtime-foundation`; verify `git rev-parse HEAD origin/codex/cognitive-runtime-foundation`.

- [ ] **Step 3: Integrate into both live branches only with lease protection**

Fetch both heads again. Fast-forward `main` from the verified feature base if it is still an ancestor; apply the same commits onto `stable` from its verified head, resolving only source-context differences if necessary. Push each branch with an exact observed-old-OID lease and stop if remote movement or branch protection rejects the operation.

- [ ] **Step 4: Verify remote containment**

Run `git ls-remote origin refs/heads/main refs/heads/stable refs/heads/codex/cognitive-runtime-foundation` and prove the cognitive commits are reachable from both branch heads with `git merge-base --is-ancestor <commit> <remote-ref>`.

- [ ] **Step 5: Report local, remote, and LIVE evidence separately**

State the exact commit, tests run, branch heads, and any pending GitHub checks. Do not call a GitHub branch LIVE-verified without an independent remote/CI or runtime observation tied to that SHA.
