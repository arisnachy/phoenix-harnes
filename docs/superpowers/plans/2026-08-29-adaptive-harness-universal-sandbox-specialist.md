# Adaptive Harness, Universal Sandbox, and Specialist Labs Implementation Plan

English | [中文](2026-08-29-adaptive-harness-universal-sandbox-specialist.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Phoenix continue from one approved mission plan, render and execute all supported artifact types in one adaptive sandbox surface, and persist evidence-backed specialist laboratories.

**Architecture:** Extend the existing approval and HARDNESS artifact seams with durable session events and one client surface. Add a specialist capability seam that composes with the existing goal supervisor, web providers, sandbox, skills, and judge without changing the agent loop. Risk-aware defaults, bounded timers, output limits, and append-only replay keep unattended progress safe and recoverable.

**Tech Stack:** TypeScript, React, CSS Modules, Cordis services/events, JSONL and SQLite session persistence, existing sandbox RPC, Vitest, Vite web tests, Playwright browser checks, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-29-adaptive-harness-design.md`

## Global Constraints

- Use one complete mission plan; only its initial approval is explicitly user-gated.
- Every later approval has a validated finite deadline and a persisted automatic outcome.
- High-risk expiry defaults to rejection and must continue through a bounded alternative strategy.
- Executable artifacts run only through the existing sandbox policy or an empty iframe sandbox; never grant network or parent access by default.
- All model-visible state is represented by session events and replayable folds.
- Specialist readiness requires independent judge evidence; retries and refreshes are bounded and configurable.
- Keep upstream `@deepseek-ai/cordis` and vendor identities unchanged; Phoenix-owned packages remain `@phoenix-ai/*`.
- Update English and required `.zh.md` documentation together and run translation pairing checks.

---

### Task 1: Durable approval deadlines and single-plan policy

**Files:**
- Modify: `packages/interaction/user-approval/src/types.ts`
- Modify: `packages/interaction/user-approval/src/index.ts`
- Modify: `packages/host/apiproxy/src/api/approvals.ts`
- Modify: `packages/host/apiproxy/src/api/approvals.schema.ts`
- Modify: `packages/client/runtime/src/client/sessions/pending.ts`
- Modify: `packages/client/runtime/src/client/sessions/session.ts`
- Create: `packages/interaction/user-approval/tests/deadline.spec.ts`
- Create: `packages/host/apiproxy/tests/api-approval-deadline.spec.ts`

**Interfaces:**
- Produce `ApprovalRisk = 'low' | 'medium' | 'high'` and `ApprovalRecommendation = 'allowed-once' | 'rejected'`.
- Produce `ApprovalDeadline { requestedAt: number; expiresAt: number; risk: ApprovalRisk; recommendation: ApprovalRecommendation; policyRevision: number }`.
- `ApprovalService.request(req)` must resolve at or before `expiresAt` when no answer arrives and append the resulting `approval/decided` event.
- API approval frames carry `deadline` and preserve the existing response method.

**Steps:**

- [ ] **Step 1: Write the failing deadline and risk tests**
Assert that a low-risk request expires to `allowed-once`, a high-risk request expires to `rejected`, an explicit answer wins before expiry, and an expired policy revision cannot auto-allow.
- [ ] **Step 2: Run the focused tests and confirm the missing deadline behavior fails**
Run: `pnpm exec vitest run packages/interaction/user-approval/tests/deadline.spec.ts packages/host/apiproxy/tests/api-approval-deadline.spec.ts --testTimeout=30000`
Expected: FAIL because the approval request has no deadline or automatic recommendation.
- [ ] **Step 3: Implement the durable deadline data and bounded decision path**
Add validated request fields, append the existing ask event with bounded deadline metadata, race the answerer against a timer, validate the policy revision at expiry, and append exactly one decided event. Keep `never` fail-closed and keep abort cancellation higher priority than expiry.
- [ ] **Step 4: Run the focused tests and verify they pass**
Run the command from Step 2. Expected: all deadline tests pass with no unhandled timer warnings.
- [ ] **Step 5: Add the single-plan rule to the goal prompt and tests**
Update `packages/goal/goal-round-driver/src/prompt.ts` and its test so the first continuation contains one complete plan approval request and later rounds contain execution/review instructions without another plan approval request.
- [ ] **Step 6: Commit the approval seam**
Run: `git add packages/interaction/user-approval packages/host/apiproxy packages/client/runtime packages/goal/goal-round-driver; git commit -m "feat: make approvals bounded and mission plans continuous"`

### Task 2: Adaptive approval countdown UI

**Files:**
- Modify: `packages/client/ui-user-questions/src/client/UserQuestionComposer.tsx`
- Modify: `packages/client/ui-user-questions/src/client/contract/slots.ts`
- Create: `packages/client/ui-user-questions/src/client/ApprovalCountdown.tsx`
- Create: `packages/client/ui-user-questions/src/client/ApprovalCountdown.module.css`
- Modify: `packages/client/ui-user-questions/tests/user-questions-composer.client.spec.tsx`
- Create: `packages/client/ui-user-questions/tests/approval-countdown.client.spec.tsx`
- Modify: `apps/web/tests/approval-composer.e2e.ts`

**Interfaces:**
- `ApprovalCountdown` accepts `deadline`, `risk`, `recommendation`, `onExpire`, and `onChoose`.
- It exposes remaining seconds through text and `aria-label`, updates once per second, and calls `onExpire` exactly once.
- It changes layout at the existing responsive breakpoint without creating a second approval panel.

**Steps:**

- [ ] **Step 1: Write the failing component tests**
Test visible recommendation/risk copy, one-second countdown updates with fake timers, expiry idempotence, explicit choice cancelling expiry, and narrow viewport layout classes.
- [ ] **Step 2: Run the component tests and confirm failure**
Run: `pnpm exec vitest run packages/client/ui-user-questions/tests/approval-countdown.client.spec.tsx packages/client/ui-user-questions/tests/user-questions-composer.client.spec.tsx --testTimeout=30000`
Expected: FAIL because the countdown component and deadline rendering do not exist.
- [ ] **Step 3: Implement the adaptive countdown and mount it in the existing composer**
Use one interval per pending approval, clear it on resolution/unmount, render a progress bar plus text, and use the already-projected approval response callback for both button clicks and expiry.
- [ ] **Step 4: Run unit tests and the approval browser scenario**
Run the command from Step 2 and `pnpm exec vitest run --config vitest.e2e.config.ts apps/web/tests/approval-composer.e2e.ts --testTimeout=30000`. Expected: all focused tests pass.
- [ ] **Step 5: Commit the countdown UI**
Run: `git add packages/client/ui-user-questions apps/web/tests/approval-composer.e2e.ts; git commit -m "feat: show bounded approval countdowns"`

### Task 3: Universal artifact envelope and adaptive renderer

**Files:**
- Modify: `packages/client/ui-conversation/src/client/conversation-nodes/hardness-artifact.ts`
- Modify: `packages/client/ui-conversation/src/client/chat/HardnessArtifactNodeView.tsx`
- Create: `packages/client/ui-conversation/src/client/chat/UniversalArtifactSurface.tsx`
- Create: `packages/client/ui-conversation/src/client/chat/UniversalArtifactSurface.module.css`
- Modify: `packages/client/ui-conversation/tests/hardness-artifact-node.client.spec.ts`
- Create: `packages/client/ui-conversation/tests/universal-artifact-surface.client.spec.tsx`
- Modify: `packages/client/ui-workspace/src/client/hardness-rpc.ts`
- Modify: `packages/api/gateway/src/hardness-rpc.ts`

**Interfaces:**
- `ArtifactKind = 'json' | 'table' | 'html' | 'code' | 'markdown' | 'text' | 'image' | 'execution'`.
- `UniversalArtifactEnvelope { id, title, kind, mime, data, language?, executable, sourceArtifactId?, size?: { minHeight, maxHeight }, result? }`.
- `UniversalArtifactSurface` selects a pure renderer from `kind`, emits `artifact/resize` only with its local token, and exposes run/stop/restart/copy/download/expand actions.

**Steps:**

- [ ] **Step 1: Write failing normalization and rendering tests**
Cover JSON pretty rendering, table detection, Python/JavaScript language labels, complete HTML normalization, Markdown fallback, image rendering, malformed payload rejection, and height clamping.
- [ ] **Step 2: Run tests and confirm the universal surface is missing**
Run: `pnpm exec vitest run packages/client/ui-conversation/tests/hardness-artifact-node.client.spec.ts packages/client/ui-conversation/tests/universal-artifact-surface.client.spec.tsx packages/client/ui-workspace/tests/artifact-preview.client.spec.ts --testTimeout=30000`
Expected: FAIL on the new envelope and renderer contract.
- [ ] **Step 3: Implement the envelope adapter and surface**
Move existing per-artifact normalization behind the envelope adapter, keep HTML in an empty `sandbox` until explicitly runnable, use `ResizeObserver`/postMessage for owned frames, clamp height to config, and retain the existing artifact node chrome only once.
- [ ] **Step 4: Add durable source/result RPC fields**
Extend the HARDNESS request/response types with `artifact/run`, `artifact/stop`, and `artifact/result`; validate ids, output caps, and execution kind at the gateway before forwarding to the sandbox provider.
- [ ] **Step 5: Run focused renderer, RPC, and client type checks**
Run the command from Step 2 and `pnpm exec tsc -b tsconfig.client.json --pretty false`. Expected: PASS.
- [ ] **Step 6: Commit the universal artifact surface**
Run: `git add packages/client/ui-conversation packages/client/ui-workspace packages/api/gateway; git commit -m "feat: add adaptive universal artifact surface"`

### Task 4: Sandbox execution and durable artifact results

**Files:**
- Modify: `packages/hardness/adapters/src/visual-runtime.ts`
- Modify: `packages/hardness/adapters/src/sandbox-guard.ts`
- Modify: `packages/hardness/adapters/tests/visual-runtime.spec.ts`
- Modify: `packages/hardness/adapters/tests/sandbox-guard.spec.ts`
- Modify: `packages/client/ui-conversation/src/client/chat/UniversalArtifactSurface.tsx`
- Modify: `packages/session/session/src/types.ts`

**Interfaces:**
- `runArtifact(request)` accepts only `executable` artifacts and returns `{ status, stdout, stderr, files, durationMs }` with configured caps.
- HTML/JavaScript uses the browser sandbox path; Python and process code uses the configured server sandbox path.
- `artifact/source` and `artifact/result` session events are replayable and do not rerun code during reconstruction.

**Steps:**

- [ ] **Step 1: Add failing execution, timeout, cancellation, and replay tests**
Use the existing adapter harness to prove Python output, HTML isolation, stop behavior, output truncation, and replay without a second execution.
- [ ] **Step 2: Run the adapter tests and confirm the new execution contract fails**
Run: `pnpm exec vitest run packages/hardness/adapters/tests/visual-runtime.spec.ts packages/hardness/adapters/tests/sandbox-guard.spec.ts --testTimeout=30000`
Expected: FAIL on missing artifact execution and durable result events.
- [ ] **Step 3: Implement one guarded execution path**
Route by explicit execution kind, enforce timeout/output/file limits from validated config, abort the underlying process on stop, and append a bounded result event after completion or failure.
- [ ] **Step 4: Run focused adapter and UI tests**
Run the commands from Steps 2 and Task 3 Step 5. Expected: PASS.
- [ ] **Step 5: Commit sandbox execution**
Run: `git add packages/hardness/adapters packages/client/ui-conversation packages/session/session; git commit -m "feat: execute artifacts through the guarded sandbox"`

### Task 5: Persistent specialist laboratory capability

**Files:**
- Create: `packages/specialist/specialist/src/types.ts`
- Create: `packages/specialist/specialist/src/domain.ts`
- Create: `packages/specialist/specialist/src/fold.ts`
- Create: `packages/specialist/specialist/src/index.ts`
- Create: `packages/specialist/specialist/tests/domain.spec.ts`
- Create: `packages/specialist/specialist/tests/fold.spec.ts`
- Modify: `packages/session/session/src/types.ts`
- Modify: `packages/goal/goal-round-driver/src/prompt.ts`

**Interfaces:**
- `SpecialistPhase = 'scoping' | 'researching' | 'hypothesizing' | 'experimenting' | 'evaluating' | 'ready' | 'blocked'`.
- `SpecialistProfile { id, subject, objective, criteria, riskClass, refreshPolicy }`.
- `SpecialistEvent` records source, dataset, hypothesis, experiment, result, improvement, and judge transitions with bounded content and provenance.
- `foldSpecialist(events, id)` returns the durable current lab view; invalid transitions throw before append.

**Steps:**

- [ ] **Step 1: Write failing fold and transition tests**
Test the complete lifecycle, rejection of out-of-order transitions, source provenance, bounded errors, and readiness only after a passing judge event.
- [ ] **Step 2: Run specialist tests and confirm the seam is absent**
Run: `pnpm exec vitest run packages/specialist/specialist/tests/domain.spec.ts packages/specialist/specialist/tests/fold.spec.ts --testTimeout=30000`
Expected: FAIL because the specialist package and session event map do not exist.
- [ ] **Step 3: Implement the domain, fold, and plugin registration**
Add the new package metadata, session event declarations, transition validators, source hash/provenance fields, refresh bounds, and Cordis service registration. Keep the domain independent from providers.
- [ ] **Step 4: Add the specialist mission prompt contract**
Update the goal prompt to direct the model through research, hypothesis, experiment, evaluation, and independent judge steps, while prohibiting unsupported certainty and unattended external side effects.
- [ ] **Step 5: Run tests and host typecheck**
Run the command from Step 2 and `pnpm exec tsc -b tsconfig.host.json --pretty false`. Expected: PASS.
- [ ] **Step 6: Commit the specialist domain**
Run: `git add packages/specialist packages/session/session packages/goal/goal-round-driver; git commit -m "feat: add persistent specialist laboratories"`

### Task 6: Specialist tools, automatic experiments, and judge loop

**Files:**
- Create: `packages/specialist/tool-specialist/src/index.ts`
- Create: `packages/specialist/tool-specialist/src/invariant.ts`
- Create: `packages/specialist/tool-specialist/tests/tool-specialist.spec.ts`
- Modify: `packages/goal/goal-round-driver/src/index.ts`
- Modify: `packages/goal/tool-goal/src/judge.ts`
- Modify: `packages/skill/skill/src/index.ts`

**Interfaces:**
- Model tool `specialist_start`, `specialist_status`, `specialist_add_source`, `specialist_run_experiment`, and `specialist_refresh` operate on branded lab ids.
- `selectNextLabAction(view)` chooses the next bounded action without repeating a failed action immediately.
- `judgeSpecialist(view)` returns the existing structured verdict and required improvements; only `pass` enters `ready`.

**Steps:**

- [ ] **Step 1: Write failing tool and judge-loop tests**
Test a user request creates a lab, source failure selects a replacement source, experiment failure selects a different bounded strategy, failed judge creates an improvement event, and passing judge emits `ready`.
- [ ] **Step 2: Run the tool tests and verify missing behavior**
Run: `pnpm exec vitest run packages/specialist/tool-specialist/tests/tool-specialist.spec.ts packages/goal/goal-round-driver/tests/strategy.spec.ts packages/goal/tool-goal/tests/judge.spec.ts --testTimeout=30000`
Expected: FAIL on missing specialist commands and lab action selection.
- [ ] **Step 3: Implement bounded action selection and provider composition**
Use existing web search/fetch, sandbox execution, skills, session persistence, and judge services. Record each action before execution, store only bounded provider output, and re-enter the goal supervisor after each result.
- [ ] **Step 4: Implement refresh scheduling as an explicit opt-in**
Validate minimum interval, maximum consecutive refreshes, and a disabled default. A refresh that reaches its cap records `blocked` with a human-readable reason instead of looping.
- [ ] **Step 5: Run specialist, goal, and integration tests**
Run the commands from Steps 2 and `pnpm exec vitest run packages/goal/goal-round-driver/tests/supervisor.spec.ts packages/goal/goal-round-driver/tests/invariant.spec.ts --testTimeout=30000`. Expected: PASS.
- [ ] **Step 6: Commit specialist orchestration**
Run: `git add packages/specialist packages/goal packages/skill/skill/src/index.ts; git commit -m "feat: orchestrate specialist research and evaluation"`

### Task 7: Adaptive specialist UI and assembled web coverage

**Files:**
- Create: `packages/client/ui-specialist/src/client/SpecialistPanel.tsx`
- Create: `packages/client/ui-specialist/src/client/SpecialistPanel.module.css`
- Create: `packages/client/ui-specialist/src/client/index.ts`
- Create: `packages/client/ui-specialist/tests/specialist-panel.client.spec.tsx`
- Modify: `apps/web/tests/goal-multi-turn-actions.e2e.ts`
- Create: `apps/web/tests/specialist-lab.e2e.ts`
- Modify: `packages/client/ui-conversation/src/client/chat/UniversalArtifactSurface.module.css`

**Interfaces:**
- The panel consumes the folded specialist view and renders current phase, evidence count, active experiment, judge verdict, next action, and bounded refresh state.
- The panel uses compact cards on wide screens and a single-column flow on narrow screens; no fixed height may clip the active artifact.

**Steps:**

- [ ] **Step 1: Write failing panel tests**
Cover each phase, a failed judge with improvement text, ready state, blocked state, long source names, and responsive layout behavior.
- [ ] **Step 2: Run tests and confirm the panel is absent**
Run: `pnpm exec vitest run packages/client/ui-specialist/tests/specialist-panel.client.spec.tsx --testTimeout=30000`
Expected: FAIL because the panel package does not exist.
- [ ] **Step 3: Implement the adaptive panel and slot registration**
Use existing primitives and locale registration, subscribe to session projections, and let the active artifact surface determine its own height rather than imposing a panel height.
- [ ] **Step 4: Add assembled web coverage**
Create a keyless runnable fixture that requests specialist mode, records two research actions, fails one judge, applies one improvement, and reaches `ready`; assert no second plan approval is shown.
- [ ] **Step 5: Run UI and web tests**
Run the command from Step 2 and `pnpm exec vitest run --config vitest.e2e.config.ts apps/web/tests/specialist-lab.e2e.ts apps/web/tests/approval-composer.e2e.ts --testTimeout=30000`. Expected: PASS.
- [ ] **Step 6: Commit the specialist UI**
Run: `git add packages/client/ui-specialist apps/web/tests packages/client/ui-conversation/src/client/chat/UniversalArtifactSurface.module.css; git commit -m "feat: expose adaptive specialist lab status"`

### Task 8: Documentation, gates, and release evidence

**Files:**
- Modify: `packages/interaction/user-approval/README.md`
- Modify: `packages/interaction/user-approval/README.zh.md`
- Modify: `packages/client/ui-conversation/README.md`
- Modify: `packages/client/ui-conversation/README.zh.md`
- Create: `packages/specialist/README.md`
- Create: `packages/specialist/README.zh.md`
- Create: `.agents/notes/implemented/architecture/2026-08-29-adaptive-harness.md`
- Create: `.agents/notes/implemented/architecture/2026-08-29-adaptive-harness.zh.md`

**Steps:**

- [ ] **Step 1: Document shipped contracts and limits**
Document the one-plan rule, expiry policy, iframe/sandbox limits, artifact caps, specialist provenance, refresh bounds, and analytical-only handling of sensitive domains.
- [ ] **Step 2: Run focused and repository gates**
Run: `pnpm exec tsc -b tsconfig.host.json tsconfig.client.json --pretty false`; `pnpm run hygiene`; `pnpm run verify-export-jsdoc`; `pnpm run verify-translation-pairing`; `pnpm run verify-cordis-catalog`; `pnpm run verify-client-catalog`; `pnpm run build`.
Expected: every command exits 0. If a broad documentation sketch check fails, report the exact pre-existing files instead of weakening the gate.
- [ ] **Step 3: Run the browser verification**
Launch the built web app, verify the approval countdown, a long JSON artifact, executable HTML, Python output, and specialist panel at desktop and narrow widths. Capture the result outside the repository and inspect it before reporting.
- [ ] **Step 4: Inspect the final diff and status**
Run: `git diff --check`; `git status --short --branch`; `git diff --stat HEAD~8..HEAD`. Confirm no credentials or generated browser artifacts are tracked.
- [ ] **Step 5: Write the implementation note and commit documentation**
Run: `git add docs/superpowers .agents/notes/implemented packages/interaction/user-approval packages/client/ui-conversation packages/specialist; git commit -m "docs: record adaptive harness contracts"`
