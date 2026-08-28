# OpenClaw Skills Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the official MIT-licensed OpenClaw `skills/` catalog into PHOENIX as a persistent, namespaced, natively loadable skill source, with individual verification for every upstream bundle.

**Architecture:** Add a launcher capability named `openclaw-skills`, parallel to the existing Codex plugin bridge. It shallow-clones only the upstream `skills/` tree into `$DSH_HOME/openclaw-skills/openclaw`, mirrors each bundle into `$DSH_HOME/skills/openclaw-<name>` while preserving resources and rewriting only the frontmatter name, and records upstream commit plus per-skill audit metadata in a state JSON. The existing `dsh-skill-filesystem` provider and `tool-skill` consumer then discover and load these aliases without a new provider or prompt protocol.

**Tech Stack:** TypeScript, Node `fs`, `child_process`, PHOENIX `dsh-skill-filesystem`/`dsh-tool-skill`, Vitest, Git sparse checkout, OpenClaw MIT source.

---

### Task 1: Define the failing bridge contract

**Files:**
- Create: `apps/cli/tests/openclaw-skills.spec.ts`

- [ ] **Step 1: Write the failing unit contract**

Create tests for deterministic namespacing and upstream bundle audit records:

```ts
import { describe, expect, it } from 'vitest'
import { openClawAlias, auditBundle } from '../src/openclaw-skills.ts'

describe('OpenClaw skill bridge contract', () => {
  it('namespaces every upstream skill without changing its kebab identity', () => {
    expect(openClawAlias('diagram-maker')).toBe('openclaw-diagram-maker')
    expect(openClawAlias('bad_name')).toBe('openclaw-bad-name')
  })

  it('records MIT/source and runtime signals without copying secret values', () => {
    const record = auditBundle('weather', '---\nname: weather\ndescription: Weather\n---\n\nUse wttr.in and curl.')
    expect(record).toMatchObject({
      sourceName: 'weather',
      license: 'MIT',
      modelInvocable: true,
      userInvocable: true,
      signals: ['network', 'external-runtime'],
    })
    expect(JSON.stringify(record)).not.toMatch(/secret|token|api[_ -]?key/i)
  })
})
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `pnpm exec vitest run apps/cli/tests/openclaw-skills.spec.ts`

Expected: FAIL because `apps/cli/src/openclaw-skills.ts` does not yet exist.

### Task 2: Implement the persistent OpenClaw bridge

**Files:**
- Create: `apps/cli/src/openclaw-skills.ts`
- Modify: `apps/cli/src/bin.ts:28-37`
- Modify: `apps/cli/src/args.ts` only if the launcher parser requires a new top-level mode (the direct dispatch must remain outside `dsh plugin`)

- [ ] **Step 1: Implement pure alias/audit helpers**

Export `openClawAlias(sourceName)` and `auditBundle(sourceName, sourceText)`. Normalize only the source folder name to `openclaw-` plus kebab-case, mark the source as `MIT`, and derive non-secret signals from documented command/platform/network/credential markers. Never persist matched values, only fixed signal labels.

- [ ] **Step 2: Implement safe source synchronization**

Use `$DSH_HOME/openclaw-skills/openclaw` and verify an existing remote matches `github.com/openclaw/openclaw` before fetch/reset/clean. Clone with `--filter=blob:none --depth 1 --branch main`, configure sparse checkout for `skills`, and return the exact commit SHA.

- [ ] **Step 3: Mirror bundles into the native PHOENIX root**

Copy each direct `skills/<name>` directory, including references/scripts/assets, to `$DSH_HOME/skills/openclaw-<name>`. Rewrite only the YAML `name:` field in `SKILL.md`; reject missing/unterminated frontmatter and preserve all other instructions/resources. Remove only prior managed `openclaw-*` entries recorded by this bridge.

- [ ] **Step 4: Persist state and expose commands**

Persist `$DSH_HOME/openclaw-skills/arsenal.json` with schema, source URL, commit, timestamp, 51 source/alias records, resource paths, signals, and managed paths. Implement `sync`, `list`, `inspect <alias-or-source-name>`, `verify`, `doctor`, and `path`. `verify` must report every record and fail on a missing body/resource or alias mismatch; `doctor` must distinguish missing Git/source installation from missing optional external CLIs or credentials.

- [ ] **Step 5: Dispatch the launcher command**

Add the early `dsh openclaw-skills ...` branch in `apps/cli/src/bin.ts`, before profile argument parsing, matching the existing Codex bridge so it works in source and built binaries.

- [ ] **Step 6: Run the focused unit test and confirm GREEN**

Run: `pnpm exec vitest run apps/cli/tests/openclaw-skills.spec.ts`

Expected: PASS with no warnings.

### Task 3: Prove native PHOENIX discovery and loading

**Files:**
- Modify: `apps/cli/tests/openclaw-skills.spec.ts`
- Create: `scripts/verify-openclaw-skills.ts` only if the executable verification cannot remain inside the bridge without coupling

- [ ] **Step 1: Add a filesystem-provider integration test**

Create a temporary `$DSH_HOME/skills` containing representative OpenClaw bundles with quoted descriptions, nested references, scripts, and invocation metadata. Mount `SkillRegistry`, `SkillFileSystem` with `watch: false`, then assert `ctx.skills.list()` exposes aliases and `ctx.skills.get(alias)` returns the complete body with a directory `resourceBase`.

- [ ] **Step 2: Add all-bundle verification behavior**

Run `dsh openclaw-skills verify` against the synchronized installation and assert exactly 51 records are checked, every alias is loadable through the same PHOENIX provider contract, and all 24 non-`SKILL.md` resources remain present.

- [ ] **Step 3: Add safe negative checks**

Verify that a missing bundle, malformed frontmatter, unexpected remote, or deleted resource produces a non-zero result and never deletes unmanaged skills.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run apps/cli/tests/openclaw-skills.spec.ts packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts`

Expected: PASS.

### Task 4: Install and audit the official catalog

**Files:**
- Create: `docs/subsystems/openclaw-skills.md`
- Create: `docs/superpowers/evidence/openclaw-skills-verification.json` (generated evidence; do not store credentials)

- [ ] **Step 1: Build the CLI artifact**

Run: `pnpm run build:lib:host`

Expected: successful host build.

- [ ] **Step 2: Synchronize the official source**

Run: `pnpm exec tsx apps/cli/src/bin.ts openclaw-skills sync`

Expected: upstream commit recorded and 51 bundles mirrored into the resolved `$DSH_HOME/skills` root.

- [ ] **Step 3: Verify every alias and resource**

Run: `pnpm exec tsx apps/cli/src/bin.ts openclaw-skills verify`

Expected: 51/51 skills loadable, 23/23 non-Markdown bundle resources accounted for (the upstream `skills/pyproject.toml` is catalog metadata, not a skill resource), no credential values written.

- [ ] **Step 4: Inspect every skill individually**

Run: `pnpm exec tsx apps/cli/src/bin.ts openclaw-skills list` and then `inspect` for each recorded alias. Save only names, descriptions, license, signals, resources, and status to the evidence JSON. Mark API/OAuth/device/platform-dependent skills as installed-but-conditional; mark local/offline instruction bundles as ready when their documented local runtime exists.

- [ ] **Step 5: Document usage and limits**

Document the command surface, exact alias convention, source commit, MIT attribution, how to call a skill through PHOENIX’s `skill` tool, and the distinction between free source/instructions and paid or credentialed external services.

### Task 5: Final verification before completion

**Files:**
- No production changes; inspect `git diff --check` and generated evidence.

- [ ] **Step 1: Run bridge tests and existing skill tests**

Run: `pnpm exec vitest run apps/cli/tests/openclaw-skills.spec.ts packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts packages/skill/tool-skill/tests/tool-skill.spec.ts`

Expected: PASS.

- [ ] **Step 2: Run static checks**

Run: `pnpm run typecheck` and `git diff --check`.

Expected: PASS and no whitespace errors.

- [ ] **Step 3: Run the installed doctor**

Run: `pnpm exec tsx apps/cli/src/bin.ts openclaw-skills doctor`.

Expected: PASS for Git, source commit, 51 installed bundles, and native bridge; warnings only for optional runtime/credential conditions.

- [ ] **Step 4: Report completion accurately**

Separate IMPLEMENTADO / PROBADO / VERIFICADO / PENDIENTE. Do not claim an external CLI, device, API, or paid service works unless that runtime was independently available and exercised; claim native skill loading only when all 51 `ctx.skills.get()` checks pass.
