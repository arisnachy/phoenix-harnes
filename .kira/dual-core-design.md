# Phoenix dual-core integration

Status: integration in progress; not released. Baseline: `5214d458f8a29cab9ac5c9ff053b9a41db858dab` on both remote release branches. The existing checkout is preserved; implementation uses `integration/phoenix-dual-core-20261021` in the existing isolated worktree.

## User intent and acceptance

Phoenix owns coordination, mission state, permissions, and existing learning memory. Codex App Server executes suitable programming work with durable native threads. A separately supervised official OpenClaw Gateway supplies authorized operational capabilities. Existing providers and native tools remain usable. One integration is promoted only after recovery, isolation, build, and real-provider checks pass; partial implementation must not replace the release branches.

## Architecture

Extend the existing `packages/subagent/agent-team` mission service with an execution adapter registry and deterministic capability router. `TeamJournal` and `UniversalMissionLedger` remain the single reservation, persistence, and cancellation owners. It does not replace the agent loop, goal authority, model selection, or memory store. Agent identities remain Phoenix identities, with external native session identifiers recorded as execution bindings.

Adapters expose readiness, capabilities, native start, recovery, input, cancellation, and disposal. The service chooses one adapter per operation. Codex is eligible only for its supported OpenAI Codex route and tools; selected DeepSeek, Claude, OpenRouter, and local model routes stay native unless an external adapter explicitly supports the exact route. OpenClaw is selected for explicit supported connector/automation requirements, not generic keywords. Manual engine preferences fail with a useful error when incompatible rather than silently substituting a model.

Before dispatch the service commits an idempotency reservation and flushes the owning session. Before each native side effect the adapter checkpoints the external binding and dispatch phase. Reconnections inspect the same native execution. An uncertain Codex turn submission cannot be retried automatically because transport failure does not prove that execution never started. Unknown outcomes are reconciled or surfaced for deliberate continuation; they never start a second engine as fallback. OpenClaw native idempotency keys are derived from the reserved execution identity.

Permissions are fixed by the originating Phoenix request, bounded by adapter support, and rechecked during execution. No model-provided engine identifier or resumed native session may broaden tools, filesystem scope, approval policy, or account scope. Approvals use Phoenix's interaction service and deny safely when unavailable. Account authentication stays in official product flows; access tokens never enter mission records, prompts, UI status, diagnostics, or Git.

Reuse the learning service with explicit session/project filters and a bounded context allowance. Do not use its mutable global current-project field to select another task's context. Record model-visible recalled context in the owning session before sending it externally. External failures and successful procedures enter the existing redacted learning pipeline with provenance; no second memory database is introduced.

OpenClaw runs outside Phoenix with a versioned installation and private state/configuration. Public Gateway APIs are used. Current official releases require a newer Node than Phoenix's active Node 22.21.1; provision and verify a separate compatible runtime rather than changing Phoenix's Node globally. Do not automatically connect channels, pair devices, or grant broad Gateway scopes.

Updates prepare immutable candidates, verify official origins and package integrity, run protocol/health tests, and defer activation while executions are live or uncertain. Keep the prior active executable and settings. Failed candidate health checks restore the executable pointer; migrations cannot overwrite user session, memory, project, or credential directories. DeepSeek upstream quarantine must distinguish an actual independently configured upstream from Phoenix's own origin and must not invent a replacement repository.

## Implementation sequence

1. Record release refs, baseline test results, and a Git bundle; verify restoration into an independent bare repository.
2. Define execution types, strict event decoding/folding, router, reservation/flush rules, and process ownership. Test duplicate starts, interrupted dispatch, callback errors, and disposal.
3. Extend the existing Codex transport with durable start/resume/read/steer, supported progress events, approvals, and session recovery while preserving its one-shot API.
4. Implement and test an isolated official OpenClaw Gateway client and managed runtime using the public protocol and minimal required scopes.
5. Compose adapter registration, native fallback, tool consumer, settings persistence, and bounded scoped memory. Test through the real Loader.
6. Add Eclipse execution-engine settings/status and diagnostics without changing the existing two model seats or selected model.
7. Integrate update candidate verification, busy deferral, failure rollback, and quarantine-source validation.
8. Run unit, assembled snapshot/browser, built runtime, official-provider, recovery, isolation, and regression checks. Review independently before publishing both release branches to exactly the same commit.

## Verification rules

Mock protocol tests establish deterministic lifecycle behavior; they do not establish official runtime compatibility. Real Codex tests must create a file, retain the native thread identifier, restart its process, resume the same thread, and verify output. Real OpenClaw tests must demonstrate authenticated local readiness, supported session/automation operations without contacting unapproved recipients, reconnection, and cancellation. Restart recovery must prove that a reserved task is not executed twice. Test provider switching and preserve exact picker preferences.

Measure elapsed time and reported native usage on the same tasks before and after. Token savings are reported only when usage evidence is available. Absence of a paid API credential, Gateway pairing, or an independent DeepSeek upstream is a concrete verification/configuration limitation, not a successful test or permission to fabricate one.

## Baseline evidence

The first focused baseline ran 60 tests: 57 passed and three Codex tests failed because they expect the package-pinned CLI path while the managed updater selects the installed official CLI. Full output is `.artifacts/dual-core/baseline-tests.log`. The restoration bundle and SHA256 are in `.artifacts/dual-core`; this point restores source history, not user data, which the integration must leave untouched.
