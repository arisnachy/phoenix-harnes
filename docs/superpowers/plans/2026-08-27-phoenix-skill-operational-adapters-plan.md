# PHOENIX Skill Operational Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every skill visible through `ctx.skills.list()` discoverable and operationally understandable by every model in PHOENIX, then verify each skill individually and report its purpose, invocation, requirements, and execution mode.

**Architecture:** Add a model-neutral adapter seam to `@phoenix-ai/dsh-skill`, apply it at the common `@phoenix-ai/dsh-tool-skill` loader boundary, and render a generated PHOENIX preflight before the original skill body. Keep upstream bodies untouched, derive profiles dynamically from the current runtime catalog, and use explicit overrides only for safety-critical ambiguity such as weather locations.

**Tech Stack:** TypeScript, Cordis services, PHOENIX `ctx.skills` registry, `tool-skill`, Vitest, `tsx`, Markdown/JSON evidence.

---

## Files and responsibilities

- Create: `packages/skill/skill/src/operational.ts` — profile types, profile derivation, override registry, preflight rendering, and language-safe operational text.
- Modify: `packages/skill/skill/src/index.ts` — export operational types/functions and attach the operational profile to loaded definitions without changing provider contracts unexpectedly.
- Create: `packages/skill/skill/tests/skill-operational-adapter.spec.ts` — core RED/GREEN tests for classification, capability matching, ambiguity, and language hygiene.
- Modify: `packages/skill/tool-skill/src/index.ts` — apply the adapter at `skill` execution and user-explicit injection; expose the same profile to every model-facing path.
- Modify: `packages/skill/tool-skill/tests/tool-skill.spec.ts` — test dynamic catalog coverage, identical model-facing preflight, and refresh behavior.
- Modify: `apps/cli/src/openclaw-skills.ts` — preserve OpenClaw-specific override data while using the global adapter seam.
- Modify: `apps/cli/tests/openclaw-skills.spec.ts` — ensure OpenClaw bundles still carry safe operational profiles.
- Create: `scripts/verify-skill-operational-adapters.ts` — enumerate the actual runtime catalog, load every model-invocable skill, validate its profile, and emit a per-skill report.
- Create: `docs/subsystems/skill-operational-adapters.md` — user-facing contract, modes, preflight behavior, language policy, and examples.
- Create: `docs/superpowers/evidence/skill-operational-adapters-verification.json` — machine-readable per-skill evidence without credentials or body dumps.
- Modify: `package.json` — add `verify:skill-operational-adapters`.
- Preserve: existing OpenClaw evidence and unrelated user changes under `packages/client`, `packages/fs`, and UI plans.

---

### Task 1: Add the failing core adapter tests

**Files:**
- Create: `packages/skill/skill/tests/skill-operational-adapter.spec.ts`

- [ ] **Step 1: Write tests for a generic profile and missing capabilities**

```ts
import { describe, expect, it } from 'vitest'
import {
  buildOperationalProfile,
  renderOperationalPrelude,
  type OperationalSkillInput,
} from '@phoenix-ai/dsh-skill'

const skill = (patch: Partial<OperationalSkillInput> = {}): OperationalSkillInput => ({
  name: 'demo-skill',
  description: 'Use the demo CLI to inspect a project.',
  whenToUse: 'Use for project inspection.',
  content: 'Run the demo CLI and summarize the result.',
  ...patch,
})

describe('skill operational adapter', () => {
  it('classifies unavailable documented tools as conditional', () => {
    const profile = buildOperationalProfile(skill(), new Set<string>())
    expect(profile.executionMode).toBe('conditional')
    expect(profile.toolMappings.some(mapping => mapping.available)).toBe(false)
    expect(profile.externalRequirements).toContain('demo CLI')
  })

  it('does not invent tools that are absent from runtime capabilities', () => {
    const profile = buildOperationalProfile(skill({ description: 'Call web_fetch for a report.' }), new Set(['skill']))
    expect(profile.toolMappings).not.toContainEqual(expect.objectContaining({ available: true }))
  })

  it('requires disambiguation before querying an ambiguous weather location', () => {
    const profile = buildOperationalProfile(skill({ name: 'openclaw-weather', description: 'Current weather and forecasts.' }), new Set(['web_fetch']))
    expect(profile.requiredInputs).toContain('location')
    expect(profile.disambiguation).toContainEqual(expect.objectContaining({ input: 'location' }))
    expect(renderOperationalPrelude(profile)).toContain('no consultes la red')
  })

  it('keeps generated operational prose free of accidental Chinese markers', () => {
    const profile = buildOperationalProfile(skill(), new Set(['skill']))
    const prelude = renderOperationalPrelude(profile)
    expect(prelude).not.toContain('用途')
    expect(prelude).not.toMatch(/[\u4e00-\u9fff]/)
  })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run packages/skill/skill/tests/skill-operational-adapter.spec.ts`

Expected: FAIL because `buildOperationalProfile` and `renderOperationalPrelude` do not exist yet.

- [ ] **Step 3: Keep the RED output as the implementation checkpoint**

Record the failing assertions in the task log; do not weaken the tests or replace the adapter with a static OpenClaw-only list.

---

### Task 2: Implement the model-neutral profile contract

**Files:**
- Create: `packages/skill/skill/src/operational.ts`
- Modify: `packages/skill/skill/src/index.ts`

- [ ] **Step 1: Define the input, profile, and mapping types**

Use the exact contract from the approved spec. `OperationalSkillInput` must contain `name`, `description`, `whenToUse`, and `content`; capabilities are a `ReadonlySet<string>`. The output must contain `executionMode`, `requiredInputs`, `toolMappings`, `disambiguation`, `fallbacks`, and `externalRequirements`.

- [ ] **Step 2: Implement deterministic profile derivation**

Derive documented tool names and requirement signals from skill metadata/body, then mark a mapping available only when its normalized runtime name exists in the supplied capability set. Use no network, no model call, no credential read, and no provider-specific assumption.

Use these deterministic rules:

```ts
const externalPatterns = [
  /\b(?:cli|command|binary|ffmpeg|curl|jq|python|node|tmux)\b/i,
  /\b(?:api|oauth|token|credential|secret|device|macos|ios|android)\b/i,
]

const locationOverride = {
  requiredInputs: ['location'],
  disambiguation: [{
    input: 'location',
    rule: 'A city without a region, country, airport code, or coordinates is not unique.',
    question: '¿Qué ciudad, región, aeropuerto o coordenadas quieres consultar?',
  }],
  fallbacks: ['Use the registered web tool when available.', 'Use the approved HTTPS weather fallback only when needed.'],
}
```

The `openclaw-weather` override must be selected by exact normalized skill name; all other skills use the generic profile unless an explicit future override exists.

- [ ] **Step 3: Render a language-safe PHOENIX preflight**

Render Spanish operational labels only when the current harness locale is Spanish; render English labels when the locale is English. Never emit Chinese as a generated label. Keep skill names, commands, paths, URLs, and quoted upstream text unchanged. The preflight must state that unavailable tools are unavailable and that `conditional`/`instruction-only` skills must not be presented as executed.

- [ ] **Step 4: Export the adapter API from `@phoenix-ai/dsh-skill`**

Export the types and functions from `src/index.ts` and add `readonly operational?: SkillOperationalProfile` to `SkillDefinition`. Keep `SkillCandidate` and provider registration source-compatible; providers do not have to construct the optional field.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `pnpm exec vitest run packages/skill/skill/tests/skill-operational-adapter.spec.ts`

Expected: PASS with 4 tests and 0 failures.

---

### Task 3: Apply the adapter at the common model-facing loader

**Files:**
- Modify: `packages/skill/tool-skill/src/index.ts`
- Modify: `packages/skill/tool-skill/tests/tool-skill.spec.ts`

- [ ] **Step 1: Add a failing loader test**

Register a runtime skill whose body says `Call web_fetch`, expose only `skill` in the test tool set, execute `skill({ name: 'demo-skill' })`, and assert the returned rendered content contains the operational preflight with `conditional` and no available `web_fetch` mapping.

Also add a test that creates two agent/model stubs with the same visible tools and asserts their loaded `<skill_content>` strings are byte-identical.

- [ ] **Step 2: Run the tests and verify RED**

Run: `pnpm exec vitest run packages/skill/tool-skill/tests/tool-skill.spec.ts`

Expected: the new preflight assertions fail while existing catalog tests remain unchanged.

- [ ] **Step 3: Compute the runtime capability set at load time**

At the existing `ctx.skills.get()` boundary, derive capabilities from the exact model-visible schema projection: `new Set(ctx.tools.schemas(exec.agent).map(schema => schema.name))`. Do not inspect private tool implementations or use a hard-coded provider list. Call `buildOperationalProfile` with the loaded definition and capabilities, assign the returned profile to `operational`, then render the preflight before the original content for both:

- the model-facing `skill` tool result;
- the user-explicit `/<skill-name>` injection path.

- [ ] **Step 4: Extend the output schema only with safe structured metadata**

Keep `name`, `provider`, `resourceBase`, and `content` backward-compatible. If operational metadata is exposed, add a closed object containing only non-secret strings, booleans, and arrays; never include raw body text, environment values, tokens, or account identifiers.

- [ ] **Step 5: Add model-neutral catalog guidance**

Update the catalog guidance to say every model must load the exact skill before acting, follow the preflight, ask for missing/ambiguous inputs, and never claim a conditional action was executed. Do not add provider-specific or Chinese labels.

- [ ] **Step 6: Run the tests and verify GREEN**

Run: `pnpm exec vitest run packages/skill/tool-skill/tests/tool-skill.spec.ts`

Expected: all existing tests plus the new preflight tests pass.

---

### Task 4: Preserve OpenClaw behavior and add weather regression coverage

**Files:**
- Modify: `apps/cli/src/openclaw-skills.ts`
- Modify: `apps/cli/tests/openclaw-skills.spec.ts`

- [ ] **Step 1: Add failing assertions for every installed OpenClaw alias**

Extend the existing native invocation test to assert each loaded alias has a non-empty operational preflight and a valid execution mode. Add cases for `openclaw-weather` with `Santiago` and `Santiago de los Caballeros, Dominican Republic` as input-validation fixtures.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm exec vitest run apps/cli/tests/openclaw-skills.spec.ts`

Expected: the new operational assertions fail before bridge integration.

- [ ] **Step 3: Connect the bridge override without changing upstream checkout**

Pass the existing OpenClaw source/alias metadata into the global adapter override registry. Keep `$DSH_HOME/openclaw-skills/openclaw` unchanged and continue installing aliases under `$DSH_HOME/skills/openclaw-*`.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `pnpm exec vitest run apps/cli/tests/openclaw-skills.spec.ts`

Expected: all OpenClaw tests pass and `openclaw-weather` refuses ambiguous location resolution before network.

---

### Task 5: Build the per-skill verifier and report

**Files:**
- Create: `scripts/verify-skill-operational-adapters.ts`
- Modify: `package.json`
- Create: `docs/superpowers/evidence/skill-operational-adapters-verification.json`
- Create: `docs/subsystems/skill-operational-adapters.md`

- [ ] **Step 1: Add the verifier command**

Register `verify:skill-operational-adapters` as `tsx scripts/verify-skill-operational-adapters.ts`. The script must use the actual runtime `ctx.skills.list()` snapshot, then for each model-invocable entry:

```ts
for (const summary of snapshot.skills) {
  const definition = await ctx.skills.get(summary.name, lookup)
  const profile = buildOperationalProfile(definition, capabilities)
  assert(profile.skillName === summary.name)
  assert(profile.executionMode !== undefined)
  assert(renderOperationalPrelude(profile).length > 0)
  results.push({ name: summary.name, description: summary.description, profile, loaded: true })
}
```

Write only summary/profile/status fields to JSON. Do not write `content`, environment values, credentials, or network responses.

- [ ] **Step 2: Produce one row per visible skill**

The Markdown report must state for every row: exact skill name, what it is for, how to call it, required inputs, available/conditional mode, external requirements, and the individual load-test result. It must explicitly state when a capability is instructional only.

- [ ] **Step 3: Test the verifier against OpenClaw and built-in/runtime skills**

Run: `pnpm run verify:skill-operational-adapters`

Expected: one `PASS` line per model-invocable skill visible in the current runtime and a JSON report with matching count and zero failed loads.

---

### Task 6: Language and documentation verification

**Files:**
- Modify: `docs/subsystems/skill-operational-adapters.md`
- Create: `scripts/verify-skill-language-hygiene.ts`
- Modify: `package.json`

- [ ] **Step 1: Add language hygiene checks**

The checker must scan generated preflight/report text and fail on accidental Chinese ideographs or the marker `用途`. It must permit code blocks, URLs, identifiers, and upstream quoted content only when explicitly marked as source text. It must verify Spanish and English generated labels are complete and not mixed.

- [ ] **Step 2: Document the English translation phase**

Document that the later full English translation will produce English overlays for all visible skill instructions and docs while preserving upstream originals, licenses, identifiers, commands, and URLs. Do not translate the upstream checkout in place.

- [ ] **Step 3: Run language checks**

Run: `pnpm run verify:skill-language-hygiene`

Expected: PASS with zero accidental Chinese markers and zero mixed generated labels.

---

### Task 7: Full verification and final per-skill report

**Files:**
- Modify: `docs/superpowers/evidence/skill-operational-adapters-verification.json`

- [ ] **Step 1: Run focused tests**

Run: `pnpm exec vitest run packages/skill/skill/tests/skill-operational-adapter.spec.ts packages/skill/tool-skill/tests/tool-skill.spec.ts apps/cli/tests/openclaw-skills.spec.ts`

Expected: all focused tests pass with 0 failures.

- [ ] **Step 2: Run the per-skill verifier**

Run: `pnpm run verify:skill-operational-adapters`

Expected: every current model-invocable skill reports `loaded: true`, with no duplicate names and no missing profiles.

- [ ] **Step 3: Run host typecheck/build**

Run: `pnpm run typecheck`

Expected: exit code 0.

- [ ] **Step 4: Run formatting and language checks**

Run: `git diff --check; pnpm run verify:skill-language-hygiene`

Expected: exit code 0 and no whitespace/language failures.

- [ ] **Step 5: Review unrelated changes before reporting**

Run: `git status --short --branch`. Preserve existing modifications in `packages/client`, `packages/fs`, and unrelated plans. Report only adapter files as this feature's outputs.

---

## Phase 2: complete English translation (separate follow-up)

After Phase 1 is accepted, create a separate translation plan. It must enumerate all visible skills, generate English overlays rather than editing upstream bodies, preserve technical identifiers and URLs, run language-pair checks, and verify that every model receives the English overlay when the user locale is English. Do not combine translation implementation with the adapter core patch.
