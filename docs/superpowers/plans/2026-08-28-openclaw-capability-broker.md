# OpenClaw Capability Broker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the pinned 153-extension OpenClaw catalog into a governed on-demand capability source that HARDNESS can prepare, activate, execute, verify, reuse, and quarantine.

**Architecture:** Keep Phoenix as the only control plane. An `OpenClawCapabilityBroker` sits between ATLAS and execution: it selects an experimental OpenClaw candidate, prepares it through an isolated host, moves it to `testing`, executes it through a dedicated executor, records real execution evidence, promotes only successful capabilities, and quarantines failed ones. External side effects, package installation, credentials, and risky permissions remain Phoenix-approved; discovery never executes plugin code.

**Tech Stack:** TypeScript, Cordis, HARDNESS/ATLAS, Phoenix Approval/Guard, Phoenix subprocess seam, Vitest, OpenClaw plugin package metadata pinned to OpenClaw 2026.8.1 / donor commit `515c3d8ff3fce77838d69d1da838ad691c18d755`.

**Spec:** `docs/superpowers/specs/2026-08-28-openclaw-extensions-graft-design.md`

## Global Constraints

- Phoenix remains the only canonical control plane.
- OpenClaw discovery is metadata-only and never executes runtime code.
- No mutable OpenClaw `main` code is downloaded implicitly.
- Package preparation uses an exact donor version/spec and is a governed side effect.
- Secrets stay behind Phoenix credential references and are never exposed to the model or catalog.
- Capabilities start `experimental`; preparation may move them to `testing`; only successful real execution evidence may promote them to `verified`.
- Failed preparation/execution is isolated and can quarantine the affected capability without crashing Phoenix.
- `main` promotion requires exact-head gates; `stable` only moves to a verified `main` SHA.

---

### Task 1: Real acquisition semantics

**Files:**
- Modify: `packages/hardness/adapters/src/acquisition-registry.ts`
- Modify: `packages/hardness/adapters/tests/acquisition-registry.spec.ts`

**Interfaces:**
- `CapabilityBuilder` may prepare/register a candidate but cannot fabricate successful execution evidence.
- `acquireOrBuild(need)` returns a `testing` capability; verification happens after execution.

- [ ] Write a failing test requiring acquisition to leave a candidate in `testing`, not `verified`.
- [ ] Run the focused test and confirm the old auto-promotion behavior fails it.
- [ ] Remove synthetic passed evidence/promotion from acquisition while retaining learning records for preparation.
- [ ] Run the focused test and confirm it passes.

### Task 2: OpenClaw Capability Broker

**Files:**
- Create: `packages/hardness/adapters/src/openclaw/broker.ts`
- Create: `packages/hardness/adapters/tests/openclaw-broker.spec.ts`
- Modify: `packages/hardness/adapters/src/openclaw/index.ts`

**Interfaces:**
- `OpenClawCapabilityHost.prepare(extensionId, signal)` returns an executable prepared extension or a typed blocked result.
- `OpenClawCapabilityHost.execute(extensionId, args, context)` returns a Phoenix `ToolExecutionResult`-compatible result.
- `OpenClawCapabilityBroker.acquire(need)` selects only matching OpenClaw catalog candidates and prepares one lazily.
- `OpenClawCapabilityBroker.execute(surface, args, context)` executes only `openclaw:*` surfaces.

- [ ] Write failing tests for candidate selection, lazy preparation, blocked preparation, and execution dispatch.
- [ ] Run the focused tests and confirm the broker is absent.
- [ ] Implement the broker with deterministic extension-id ordering and failure isolation.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Hybrid policy and real evidence

**Files:**
- Modify: `packages/hardness/adapters/src/execution-bridge.ts`
- Modify: `packages/hardness/adapters/src/mission-orchestrator.ts`
- Modify: `packages/hardness/adapters/tests/execution-bridge.spec.ts`
- Modify: `packages/hardness/adapters/tests/mission-orchestrator.spec.ts`

**Interfaces:**
- `CapabilityExecutor` handles non-`tool:*` surfaces such as `openclaw:*`.
- Every routed capability still goes through Phoenix approval before execution.
- Successful execution records passed evidence and may promote `testing` to `verified`.
- Execution failure records failed evidence and quarantines the selected capability.

- [ ] Write failing tests proving non-tool OpenClaw execution delegates after approval.
- [ ] Write failing tests proving successful real execution promotes and failure quarantines.
- [ ] Implement executor delegation and evidence recording.
- [ ] Run focused tests and confirm green.

### Task 4: Runtime wiring

**Files:**
- Modify: `packages/hardness/adapters/src/mission-runtime.ts`
- Modify: `packages/hardness/adapters/src/index.ts`
- Modify: `packages/hardness/adapters/tests/mission-runtime.spec.ts`

**Interfaces:**
- `createHardnessAcquisition()` includes the OpenClaw broker builder when an OpenClaw host is supplied.
- `installHardnessMissionRuntime()` passes the broker as the non-tool executor.
- Absence of a host leaves the catalog discoverable but cannot falsely mark it executable.

- [ ] Write failing runtime wiring tests.
- [ ] Implement optional broker/host wiring without changing startup behavior for unavailable hosts.
- [ ] Run focused tests.

### Task 5: Isolated package host contract

**Files:**
- Create: `packages/hardness/adapters/src/openclaw/package-host.ts`
- Create: `packages/hardness/adapters/tests/openclaw-package-host.spec.ts`

**Interfaces:**
- Package resolution is exact and deterministic (`2026.8.1`, pinned donor metadata).
- The host exposes preparation/execution as a narrow contract; package code cannot mutate ATLAS directly.
- Missing package, platform, secret, unsupported registration surface, and worker failure map to typed diagnostics.
- Package install is separate from activation and is an approval-worthy side effect.

- [ ] Write tests for exact install candidate resolution and no mutable source URLs.
- [ ] Implement package metadata resolution and isolated-host lifecycle contract.
- [ ] Add family registration inventory for tools, providers, channels, memory, devices, media/voice, web/search, secrets, work, coding, and observability.
- [ ] Run focused tests.

### Task 6: Full regression and promotion

**Files:**
- Modify only generated/docs/package metadata required by repository gates.

- [ ] Run focused HARDNESS/OpenClaw/UI tests.
- [ ] Run repository CI on the exact PR head.
- [ ] Fix only attributable or promotion-blocking base-gate violations with evidence.
- [ ] Mark PR ready and merge expected head to `main`.
- [ ] Verify `main` workflow results and branch SHA.
- [ ] Fast-forward `stable` to that exact verified `main` SHA.
- [ ] Verify `stable` points at the same SHA.
