# PHOENIX — Zero-Cost Harness Benchmark Baseline

Date: 2026-09-23  
Branch: `benchmark/phoenix-zero-cost-20260923`  
Deep benchmark commit: `eb1e53bc14ef6bf7851a4774f6a0393f03b39466`  
Fast benchmark commit: `a05b3c591440cbb9d38fe797b01085982fd8bcce`

## Executive conclusion

PHOENIX can now be benchmarked on GitHub without model-provider API calls. The benchmark explicitly blanks provider credentials and uses local deterministic tests, mock LLM behavior, replay/snapshots, and build gates.

The first deep baseline consumed **0 provider API tokens** and has expected provider API cost **$0**.

The strongest parts of the current harness are the local provider boundary and request reconstruction. The main weaknesses found are:

1. contract/test drift around the completion judge;
2. a large snapshot baseline drift dominated by one runtime-context prompt wording change;
3. dependency and generated-remote consistency problems exposed by static/Wine gates;
4. stale generated catalogs/docs and package-export hygiene;
5. no dedicated browser input-to-dispatch latency or local serialized-token estimator yet.

These are fixable harness/repository issues rather than evidence that the underlying agent loop is broadly broken.

## Benchmark runs

### Deep baseline

GitHub Actions run: https://github.com/arisnachy/phoenix-harnes/actions/runs/35882271036

| Lane | Result | Time | Detail |
|---|---:|---:|---|
| Local mock LLM contract + fault injection | PASS | 6.70 s | 72/72 tests passed |
| Agent-loop request reconstruction | PASS | 2.39 s | 25/25 tests passed |
| Adversarial completion/judge gate | FAIL | 1.92 s | 6/8 passed; 2 failures |
| Deterministic snapshot/replay | FAIL | 175.43 s | 33 passed, 92 failed, 4 skipped |
| Host + client library build | PASS | 95.90 s | exit 0 |

Measured lane time: **282.33 s**.  
Repository inventory: **1100 test files**.

The workflow itself completed successfully and uploaded the complete raw evidence artifact.

Artifact: https://github.com/arisnachy/phoenix-harnes/actions/runs/35882271036/artifacts/10761014103

### Fast baseline

GitHub Actions run: https://github.com/arisnachy/phoenix-harnes/actions/runs/35882970714

The default benchmark was then optimized so normal commits do not duplicate expensive repository CI.

| Lane | Result | Time |
|---|---:|---:|
| Local mock LLM contract + fault injection | PASS | 5.49 s |
| Agent-loop request reconstruction | PASS | 2.77 s |
| Adversarial completion/judge gate | FAIL | 2.23 s |
| Snapshot/replay | skipped in fast mode | — |
| Host + client build | skipped in fast mode | — |

Measured fast-lane time: **10.49 s**.

This is the recommended per-commit mode. Deep mode remains available for isolated full baselines.

## What is already strong

### 1. Provider boundary and failure simulation

The mock LLM suite passed **72/72 tests**. This is important because it validates the zero-cost foundation used to exercise provider contracts and fault behavior without a real model.

**Interpretation:** do not spend optimization time rewriting this layer first.

### 2. Agent-loop request reconstruction

The request reconstruction suite passed **25/25 tests**.

It covers reconstruction/history behavior, tool capability handling, contextual acknowledgments, provider/model switching and related request state.

**Interpretation:** the core request-reconstruction path is currently a stable baseline.

### 3. Official builds are not globally broken

The deep benchmark's host + client library build passed. The existing main guard also passed host/client contracts and the exact main build. Native Windows required gates passed as well.

**Interpretation:** the repository can build successfully; failures seen in other lanes are conditional/environmental or source-of-truth drift rather than a universal compile failure.

## Finding A — Completion judge tests are out of sync

Priority: **P0 to clean the benchmark; likely contract/test drift rather than two independent judge logic defects.**

The adversarial completion suite ran 8 tests:

- 6 passed
- 2 failed

### Failure A1 — brittle exact phrase assertion

The test requires the execution prompt to contain the literal string:

`expected-value provenance`

The current prompt no longer contains that exact label, but it still explicitly instructs the verifier to classify material expected values by provenance: specification, reference oracle/standard, mathematical or metamorphic invariant, external fixture, or implementation itself.

**Diagnosis:** the semantic requirement remains present, while the test is coupled to an old phrase.

**Repair:**

- either restore a stable machine-oriented marker such as `expected_value_provenance` to the prompt contract;
- or make the test assert the semantic contract/structured field instead of fragile prose.

A stable structured marker is preferable if downstream tooling depends on it.

### Failure A2 — digest schema advanced but fixture did not

The historical PASS reuse test expects:

```ts
{
  verdict: 'pass',
  summary: 'Certified independently.',
  findings: [],
  requiredChanges: [],
}
```

The actual digest now additionally contains:

```ts
verificationIncidents: []
```

**Diagnosis:** fixture/schema drift.

**Repair:** update the fixture and add a schema-level regression test so optional/new digest fields do not turn into confusing logic failures.

## Finding B — Snapshot/replay is red, but 92 failures are not 92 independent bugs

Priority: **P0/P1: re-establish a trustworthy deterministic baseline.**

Snapshot summary:

- 14 files considered
- 7 test files failed
- 6 passed
- 1 skipped
- 129 tests total
- 92 failed
- 33 passed
- 4 skipped

Failure distribution is heavily concentrated:

- `examples/acp-agent/tests/acp.snapshot.ts`: 81 failures
- `examples/headless-agent/tests/headless.snapshot.ts`: 5
- `examples/acp-agent/tests/goal.snapshot.ts`: 2
- four other files: 1 each

### Dominant root cause — runtime-context wording changed

A very large fraction of diffs replace the old prefix:

`Current runtime context. This snapshot supersedes earlier runtime-context snapshots.`

with the newer:

`Background runtime context (silent; use only to improve relevance and continuity...)`

The new text appears consistently in actual output while fixtures still contain the old text.

**Diagnosis:** broad expected-snapshot drift caused by a shared system-prompt change. The 92 failures therefore substantially overstate the number of distinct defects.

**Repair sequence:**

1. review the new runtime-context wording as a product/security contract;
2. if intended, rebaseline affected snapshots in one controlled change;
3. keep a small semantic contract test for the important behavior so future harmless wording changes do not invalidate dozens of snapshots;
4. retain exact snapshots only where byte-level output is actually part of the contract.

### Independent snapshot issue — CLI badge fixture

`apps/cli/tests/dsh-badge.snapshot.ts` also failed because:

`@phoenix-ai/cordis/lib/index.js`

was not present for the fixture.

This is not merely a text snapshot update. It points at package/build preparation or dependency materialization for that fixture.

**Repair:** ensure the fixture's required workspace packages are built/materialized before the loader smoke, and test from a clean checkout.

### Translation prompt snapshot

The translation prompt snapshot also changed and should be reviewed separately before accepting a bulk snapshot update. Do not blindly rewrite all expected fixtures.

## Finding C — clean-state dependency closure is not consistent

Priority: **P0.**

The static runtime-closure gate reports missing dependencies from `python/sdk-runtime` for multiple platform presets:

- `@phoenix-ai/dsh-tool-session-learning`
- `@phoenix-ai/dsh-hardness-adapters`

Affected presets include code, cordis and standard on Linux ARM64, Linux x64 and macOS ARM64.

**Repair:** make the SDK runtime package dependency closure match the plugins actually present in each shipped preset, then exercise installation from a clean package artifact rather than relying on workspace linkage.

## Finding D — Cordis/client dependency declarations are incomplete

Priority: **P0.**

Static checks found:

- `packages/bundle/web-app/cordis.patch.yml` loads `@phoenix-ai/dsh-mcp-client`, but `packages/bundle/web-app/package.json` does not declare it as a dependency.
- `packages/client/ui-conversation` uses `@phoenix-ai/dsh-session` and `@phoenix-ai/dsh-user-approval` as peer-installed relationships, but their matching `peerDependencies` + `devDependencies` declarations are missing.

**Repair:** make loader configuration, imports and package dependency metadata derive from one source of truth or validate them at generation time.

## Finding E — cross-environment generated-remotes nondeterminism

Priority: **P0/P1.**

The exact main build passed and the official native Windows build passed. However, the Wine clean-state build failed with many missing remote imports/properties, including:

- `commands`
- `voice`
- `goals`
- `dynamicCordisRunner`
- `fileReferences`
- `sessionReferenceResolver`
- `messageFeedback`
- `pluginInventory`

and imports such as:

- `@phoenix-ai/dsh-commands/remote`
- `@phoenix-ai/dsh-goal/remote`
- `@phoenix-ai/dsh-voice/remote`

The generated `TypertClientRemote` then lacks the corresponding properties, producing a cascade of TypeScript errors.

**Interpretation:** because native Windows and exact-main builds pass, this looks like generation/build-order or clean-state/environment sensitivity, not dozens of unrelated UI defects.

**Repair:**

1. define one explicit remote-generation stage;
2. make every client build depend on it;
3. delete/recreate generated output before the reproducibility test;
4. run the same clean-build sequence on Linux and Windows;
5. compare hashes of generated remote/catalog artifacts across OSes;
6. fail early on hash/schema drift before TypeScript produces a cascade.

## Finding F — generated source-of-truth artifacts are stale

Priority: **P1.**

Static CI reports stale artifacts including:

- `docs/config-catalog.md`
- `docs/persistence-catalog.md`
- `docs/tool-catalog.md`
- `docs/module-graph.md`
- `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`

A concrete tool-catalog drift is that the generated filesystem tool list now includes `fs_status` while the committed catalog does not.

**Repair:** regenerate and commit these outputs only after P0 dependency/remote fixes, then add a single source-of-truth generation gate before build/test jobs fan out.

Known generator commands reported by CI include:

- `pnpm run gen-config-catalog`
- `pnpm run gen-persistence-catalog`
- `pnpm run gen-tool-catalog`
- `pnpm run gen-module-graph`
- `pnpm run gen-client-catalog`

## Finding G — type/document contract drift

Priority: **P1/P2.**

`FileAttachmentLimits` in source now has optional byte caps:

```ts
interface FileAttachmentLimits {
  maxFileBytes?: number
  maxFilesPerMessage: number
  maxMessageFileBytes?: number
}
```

but `docs/subsystems/attachment.md` still records those byte caps as required.

**Repair:** update the type-equivalence documentation from the source contract and keep the type-equivalence gate blocking once baseline is clean.

## Finding H — package publishing/export hygiene

Priority: **P1 before publishing packages externally.**

Publint reports widespread package export warnings where `./src/*` does not match packaged files. It also identified concrete stronger defects such as:

- a `./client` default pointing at CJS `./lib/client.js` while interpreted as ESM;
- `packages/session/session-learning` exporting `./ledger` to `./lib/ledger.js` when the file does not exist.

**Repair:** distinguish development-only source exports from publishable exports, remove impossible export patterns from published packages, and verify packed tarballs rather than the workspace tree.

## Finding I — static repository hygiene debt

Priority: **P2 after runtime/build contract issues.**

Static CI summary: **21 gates passed, 18 failed**.

Other debt includes:

- 178 exported-JSDoc completeness violations;
- bilingual documentation pairing drift;
- malformed/incomplete Agent Notes;
- stale README model-experience/limitations sections;
- Knip findings for unused files/dependencies/devDependencies and an unlisted `codex` binary;
- multiple cyclic workspace dependency groups reported by pnpm installation.

These matter, but they should not distract from dependency closure, remotes generation, judge baseline and replay determinism.

## Improvement order

### Phase 1 — restore deterministic correctness

1. Fix SDK runtime dependency closure.
2. Fix web-app MCP and UI conversation peer dependency declarations.
3. Make remote/catalog generation an explicit deterministic prerequisite.
4. Fix the CLI badge clean-build/materialization failure.
5. Repair the two completion-gate fixture/contract mismatches.

**Exit criterion:** fast zero-cost benchmark is 3/3 green and clean official builds are reproducible.

### Phase 2 — restore replay as a reliable oracle

1. Review the new runtime-context wording.
2. Rebaseline only the snapshots whose semantic change is accepted.
3. Review translation-prompt and CLI badge failures independently.
4. Reduce broad text snapshots where a semantic assertion is sufficient.

**Exit criterion:** snapshot/replay 129/129 applicable tests green (excluding intentional platform skips).

### Phase 3 — clean repository source-of-truth drift

1. Regenerate config/persistence/tool/module/client catalogs.
2. Fix type-equivalence drift.
3. Repair Publint exports.
4. Clear Knip/dependency metadata.
5. Repair required JSDoc and bilingual/Agent Note gates.

**Exit criterion:** static CI 39/39 gates green.

### Phase 4 — measure the user-visible problems that headless tests cannot see

Add a Playwright latency probe with timestamps for:

`Enter -> optimistic user bubble -> request dispatch -> first thinking state -> first response chunk -> thinking cleared`

Recommended tracked metrics:

- p50/p95 input-to-bubble
- p50/p95 input-to-dispatch
- first-chunk latency excluding model latency when using local mock
- delay between final chunk and clearing the thinking indicator
- duplicate dispatch count

This will let PHOENIX catch UI regressions without using a paid model.

### Phase 5 — measure token efficiency with zero token spend

Instrument serialized requests before provider dispatch and calculate locally:

- serialized bytes
- tokenizer-estimated input tokens when a local tokenizer is available
- context growth per turn
- repeated system/runtime context
- duplicated tool results
- retry amplification
- judge prompt size and judge invocation count
- subagent context duplication

No provider call is required.

Use the same deterministic replay cassette on baseline and candidate commits and report percentage deltas.

## Recommended benchmark thresholds

| Metric | Baseline | Next target |
|---|---:|---:|
| Fast benchmark measured lanes | 10.49 s | keep < 15 s |
| Mock LLM | 72/72 | 100% |
| Request reconstruction | 25/25 | 100% |
| Completion gate | 6/8 | 8/8 |
| Snapshot/replay | 33 pass / 92 fail / 4 skip | all applicable green |
| Deep build | 95.90 s | < 90 s first, then profile further |
| Static gates | 21/39 | 39/39 |
| Provider API tokens | 0 | 0 |
| Provider API cost | $0 | $0 |
| Cross-OS generated artifact drift | observed | 0 |

## Benchmark architecture going forward

Use two modes:

### FAST — every meaningful commit

- mock provider/fault contracts
- agent-loop reconstruction
- completion/judge gate
- local token/context estimator once added
- UI dispatch probe once added

Target: seconds, not minutes.

### DEEP — release candidate / manual baseline

FAST plus:

- deterministic replay/snapshots
- full host/client build
- clean package consumer tests
- cross-OS generated-artifact hash comparison
- static gates

This gives PHOENIX a serious regression system without turning every edit into a long CI cycle.

## Bottom line

The benchmark already separates several things that previously looked like one vague "PHOENIX is slow/unstable" problem.

The core mock-provider and request reconstruction paths are green. The biggest immediate engineering leverage is to restore deterministic source generation/dependency closure, clean the judge fixture drift, and make replay trustworthy again. After that, add browser latency and local token estimation so speed and cost regressions become measurable on every commit without spending model tokens.
