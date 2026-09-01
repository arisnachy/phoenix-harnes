# Organization Forge Implementation Plan

English | [中文](2026-08-31-organization-forge.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Organization Forge ledger into a durable, evidence-driven coordinator for researching, auditing, building, verifying, and delivering organizations or systems.

**Architecture:** Extend `OrganizationForgeLedger` and the existing `organization_forge` tool with explicit research, blueprint, work, deliverable, strategy, revalidation, and sanitized Atlas records. Keep session events as the durable authority, existing tools and sandbox as execution authorities, and the independent goal judge as the completion authority.

**Tech Stack:** TypeScript strict mode, Cordis services, existing goal/session events, existing goal tool, Vitest, generated documentation catalogs, and existing HARDNESS metadata types.

**Spec:** `docs/superpowers/specs/2026-08-31-organization-forge-design.md`

## Global Constraints

- Forge is optional and remains separate from the goal engine, tool registry, sandbox, permissions, connectors, and deployment authorities.
- A Forge build cannot reach `ready` without research evidence, passing pre-reuse and post-modification audits, verified deliverables, verified required criteria, and an independent judge pass.
- Atlas records contain only redacted reusable metadata; customer data, secrets, tokens, private documents, and deployment-specific identifiers are rejected.
- A recoverable failure creates a repair or alternative-strategy record and never closes the build.
- Autonomous management is never activated without the explicit user-selected handoff mode and existing permission controls.
- Every model-visible mutation and result remains reconstructable from the owning session event log.

---

### Task 1: Add durable Forge research and build records

**Files:**
- Modify: `packages/goal/goal/src/organization-forge.ts`
- Test: `packages/goal/goal/tests/organization-forge.spec.ts`

**Interfaces:**
- Consumes: existing `OrganizationForgeSnapshot`, `OrganizationForgeChange`, `OrganizationForgeLedger`, and `Session.append`.
- Produces: `OrganizationForgeResearch`, `OrganizationForgeBlueprint`, `OrganizationForgeDeliverable`, `OrganizationForgeWorkItem`, `OrganizationForgeStrategy`, `OrganizationForgeAtlasEntry`, plus ledger methods `addResearch`, `setBlueprint`, `addDeliverable`, and `markDeliverable`.

- [x] **Step 1: Write the failing durable-record tests**

Add a test that starts a Forge, records a comparable repository and a tool source as research, sets a blueprint with components, infrastructure, automations, workflows, metrics, cost controls, and quality targets, then adds a deliverable and verifies it with an artifact reference. Assert every record survives `foldOrganizationForge` and detached reads.

```text
forge = ledger.addResearch(agent, forge.id, {
  kind: 'repository', title: 'Comparable platform', locator: 'https://github.com/example/platform',
  summary: 'Public reference implementation', relevance: 'Workflow and deployment comparison',
})
forge = ledger.setBlueprint(agent, forge.id, {
  components: ['api'], infrastructure: ['local sandbox'], automations: ['daily check'],
  workflows: ['research-build-verify'], metrics: ['test pass rate'], costControls: ['deterministic checks'],
  qualityTargets: ['all required criteria verified'],
})
forge = ledger.addDeliverable(agent, forge.id, {
  name: 'working service', kind: 'software', artifactRef: 'artifact:service-v1',
})
forge = ledger.markDeliverable(agent, forge.id, forge.deliverables[0].id, 'verified', ['test:service', 'smoke:service'])
expect(foldOrganizationForge(session.events).get(forge.id)?.deliverables[0]?.status).toBe('verified')
```

- [x] **Step 2: Run the focused test and verify red**

Run `pnpm exec vitest run packages/goal/goal/tests/organization-forge.spec.ts --pool=forks`.

Expected: FAIL because the new record types, snapshot fields, and ledger methods do not exist.

- [x] **Step 3: Implement the smallest typed records and snapshot fields**

Add bounded normalized records with stable ids and evidence arrays. Extend the change operation union and snapshot with `research`, optional `blueprint`, `deliverables`, `work`, `strategies`, `atlasEntries`, and optional `goalRef`. Keep existing callers valid by initializing all new collections in `start()`.

- [x] **Step 4: Implement ledger mutations with durable full-snapshot events**

Implement `addResearch`, `setBlueprint`, `addDeliverable`, and `markDeliverable`. Require a non-empty evidence list for `verified`; reject invalid ids, oversized text, invalid statuses, and deliverable verification before the build reaches `verifying`. Each mutation increments the Forge revision and appends `organization-forge/change`.

- [x] **Step 5: Run the focused test and typecheck**

Run `pnpm exec vitest run packages/goal/goal/tests/organization-forge.spec.ts --pool=forks` and `pnpm exec tsc -b packages/goal/goal --pretty false`.

Expected: the new tests and existing Forge tests pass and the package typechecks.

### Task 2: Enforce research-first quality gates and recovery records

**Files:**
- Modify: `packages/goal/goal/src/organization-forge.ts`
- Test: `packages/goal/goal/tests/organization-forge.spec.ts`

**Interfaces:**
- Consumes: Task 1 records and existing source-audit logic.
- Produces: `addWork`, `recordStrategy`, `revalidateSource`, `publishAtlasEntry`, and deterministic readiness checks.

- [x] **Step 1: Write failing gate and recovery tests**

Add tests that reject design without research, reject build without a blueprint, reject verification without an actual deliverable, retain a failed strategy as a non-terminal work record, require a different strategy id after a repeated failure fingerprint, and reject Atlas publication when any secret-like text is present.

```text
expect(() => ledger.advance(agent, forge.id, 'designing')).toThrow('research evidence')
expect(() => ledger.advance(agent, forge.id, 'building')).toThrow('blueprint')
expect(() => ledger.advance(agent, forge.id, 'verifying')).toThrow('deliverable')
expect(ledger.recordStrategy(agent, forge.id, {
  name: 'fallback', status: 'failed', failureFingerprint: 'missing-tool', summary: 'Tool unavailable',
}).phase).not.toBe('blocked')
expect(() => ledger.publishAtlasEntry(agent, forge.id, {
  name: 'bad', summary: 'api_key: secret', reusablePattern: 'unsafe',
})).toThrow('secret')
```

- [x] **Step 2: Run the new tests and verify red**

Run `pnpm exec vitest run packages/goal/goal/tests/organization-forge.spec.ts --pool=forks`.

Expected: FAIL because the lifecycle currently checks only source audits and has no recovery or Atlas records.

- [x] **Step 3: Implement deterministic lifecycle guards**

Require at least one research record before `designing`, a blueprint before `building`, and a verified deliverable before `verifying`. Require all reused sources to pass both audits before design and before any later phase. Preserve `ready` as the only delivery phase.

- [x] **Step 4: Implement strategy and active-work records**

Add strategy fingerprints and work records with `active`, `completed`, and `failed` statuses. A repeated failure fingerprint cannot be recorded as the same strategy; the method must require a new strategy id/name and keep the Forge phase active. Completed work remains in durable history while a projection helper returns only active work for UI use.

- [x] **Step 5: Implement revalidation and sanitized Atlas publication**

Add `revalidateSource` as a post-modification audit operation with a current timestamp and evidence. Add `publishAtlasEntry` that validates title, summary, reusable pattern, and source id, rejects credential-like values and private locators, and requires passing pre/post audits plus current revalidation. Store only sanitized metadata in the Forge snapshot.

- [x] **Step 6: Run focused tests and typecheck**

Run `pnpm exec vitest run packages/goal/goal/tests/organization-forge.spec.ts --pool=forks` and `pnpm exec tsc -b packages/goal/goal --pretty false`.

Expected: all lifecycle, recovery, security, and replay tests pass.

### Task 3: Expose the complete workflow through the model-facing tool

**Files:**
- Modify: `packages/goal/tool-goal/src/index.ts`
- Test: `packages/goal/tool-goal/tests/organization-forge.spec.ts`
- Modify: `packages/goal/tool-goal/README.md`
- Modify: `packages/goal/tool-goal/README.zh.md`

**Interfaces:**
- Consumes: Task 1 and Task 2 ledger methods plus existing `judgeGoalCompletion`.
- Produces: `organization_forge` actions `research`, `blueprint`, `deliverable`, `work`, `strategy`, `revalidate`, and `atlas`, and a model-visible `nextAction` projection.

- [x] **Step 1: Write the failing tool tests**

Add a real tool-registration fixture that calls `organization_forge` for `start`, `research`, `blueprint`, `deliverable`, `work`, `strategy`, `revalidate`, `atlas`, and `judge`. Assert the output includes the next required action, never includes credentials, and includes the handoff question only after judge pass and all required evidence.

- [x] **Step 2: Run the focused tool tests and verify red**

Run `pnpm exec vitest run packages/goal/tool-goal/tests/organization-forge.spec.ts --pool=forks`.

Expected: FAIL because the new action parameters, dispatch branches, and projection fields do not exist.

- [x] **Step 3: Extend the tool schema and descriptions**

Add strict parameters for research metadata, blueprint lists, deliverable fields, work and strategy status, revalidation evidence, and Atlas metadata. Update guidance to say that `research` is the first action after `start`, rejected judge results remain active, and the final handoff question is not a completion substitute.

- [x] **Step 4: Implement dispatch and next-action projection**

Route each action to the ledger, pass only direct-human authority to `start` and `management`, and render `nextAction` from the current phase and missing evidence. Include the exact handoff question and management choices only when the ledger returns `ready`.

- [x] **Step 5: Expand the independent judge input**

Send the current Forge revision, research, blueprint, active work, strategies, deliverables, audits, revalidation evidence, and criteria to `judgeGoalCompletion`. Record `needs_changes` findings as the next repair work instead of returning a terminal success.

- [x] **Step 6: Run tool tests and package typecheck**

Run `pnpm exec vitest run packages/goal/tool-goal/tests/organization-forge.spec.ts packages/goal/goal/tests/organization-forge.spec.ts --pool=forks` and `pnpm exec tsc -b packages/goal/tool-goal --pretty false`.

Expected: all tool actions, output gating, and package declarations pass.

### Task 4: Register the capability in documentation and evidence

**Files:**
- Modify: `packages/goal/goal/README.md`
- Modify: `packages/goal/goal/README.zh.md`
- Modify: `docs/subsystems/goal.md`
- Modify: `docs/subsystems/goal.zh.md`
- Modify: `.agents/notes/implemented/feature/2026-08-30-organization-forge.md`
- Modify: `.agents/notes/implemented/feature/2026-08-30-organization-forge.zh.md`
- Modify: `.agents/notes/implemented/feature/2026-08-30-organization-forge.i18n.yaml`

- [x] **Step 1: Document current Forge contracts**

Document the model-visible actions, durable records, research-first ordering, audit gates, recovery behavior, Atlas redaction, role responsibilities, judge requirement, and final handoff question. Keep the goal package as the owner and link the design spec.

- [x] **Step 2: Update the implemented Agent Note**

Record the shipped mechanism, alternatives considered, security consequences, failure behavior, and exact test evidence in present tense. Do not include private data or credentials.

- [x] **Step 3: Regenerate documentation derivatives**

Run `pnpm run verify-translation-pairing --write packages/goal/goal/README.md docs/subsystems/goal.md .agents/notes/implemented/feature/2026-08-31-organization-forge.md` and the relevant documentation generators.

### Task 5: Verify the complete change

- [x] **Step 1: Run focused goal and tool suites**

Run `pnpm exec vitest run packages/goal/goal/tests/organization-forge.spec.ts packages/goal/tool-goal/tests/organization-forge.spec.ts --pool=forks`.

- [x] **Step 2: Run built-path and type checks**

Run `pnpm run typecheck`, `node apps/cli/lib/bin.js --help`, and the package build smoke for the goal and tool-goal artifacts.

- [x] **Step 3: Run documentation and hygiene checks**

Run `pnpm run doc-sync`, `pnpm run verify-agent-note-format`, `pnpm run verify-translation-pairing`, and `git diff --check`.

- [x] **Step 4: Inspect the final requirement matrix**

Confirm each requirement in the design spec has an implementation, focused test, durable evidence path, and documented limitation. Report any repository-wide pre-existing failures separately instead of treating them as Forge evidence.

## Self-review checklist

- Research happens before design or reuse: Tasks 1–2.
- Pre- and post-modification audits plus revalidation gate reuse and Atlas publication: Task 2.
- Actual deliverables and evidence gate readiness: Tasks 1–3.
- Failed approaches remain active and require alternative strategies: Task 2.
- IT, Security, and R&D roles remain modular and active work is separate from history: Tasks 1–2.
- The independent judge receives the complete current Forge state and rejection loops back to repair: Task 3.
- Atlas is sanitized and management requires explicit user selection: Tasks 2–3.
- Session replay and model-visible records remain event-backed: Tasks 1–2.
