# Agent Note: Adaptive approvals, artifact execution, and persistent specialist labs

Status: implemented

English | [中文](2026-08-29-adaptive-harness-control-plane.zh.md)

## Problem

Long-running Phoenix work could stop at repeated confirmation prompts, render artifacts without one consistent execution surface, and describe specialist behavior without a replayable record of its research and evaluation. The UI, approval channel, sandbox runtime, and session log therefore needed one explicit control plane.

## Decision

Approval requests carry a finite deadline, risk class, reversibility, and policy revision. The client renders the deadline once per second and applies the server recommendation when it expires; a current policy revision is required, and high-risk or non-reversible requests default to rejection. Tool ask decisions propagate their risk metadata into the approval seam.

HARDNESS artifacts normalize into one adaptive surface. HTML remains a unique-origin iframe with a restrictive CSP. Code execution uses the loopback `artifact/run` endpoint and the mounted isolated `CodeRuntime`; missing or incompatible runtimes fail explicitly. `Stop` aborts the same signal passed to the runtime. Height is measured when `ResizeObserver` is available and clamped to a bounded responsive range.

Specialist laboratories are durable session events. `SpecialistLedger` records the topic, objective, criteria, sources, hypotheses, experiments, iteration cap, and judge result. A passing evaluation enters `ready`; a failed evaluation enters `improving` until the bounded cap, after which it enters `blocked`. The `specialist_lab` tool exposes the lifecycle to the model.

Goal continuation prompts require one complete master plan on the first round and reuse it later; routine step-by-step confirmation is not part of the continuation protocol. Existing goal supervisor checkpoints and judge feedback remain the recovery authority.

## Alternatives considered

**Client-only approval timers** — rejected: a browser clock cannot decide a server-owned action safely, especially after reconnect or a policy change. The deadline and policy revision are persisted and authoritative on the host.

**Execute code directly in the browser** — rejected: browser evaluation cannot provide the harness sandbox, workspace identity, or runtime cancellation guarantees. HTML is isolated for presentation; code execution belongs to the mounted host runtime.

**Keep specialist state in React or an external cache** — rejected: it would disappear on restart and would not be reconstructable from the session transcript. Full snapshots in `specialist/change` follow the existing event-sourced goal pattern.

## Consequences

The UI no longer needs a per-step confirmation for a goal continuation, and later approval decisions are bounded and auditable. Safe auto-allow requires the producer to mark an action low-risk and reversible; unspecified asks remain fail-closed. The universal surface can present code and HTML immediately, but Python execution is available only when a compatible Python runtime provider is mounted; this implementation does not pretend that the protocol-only Python package is an executor. Specialist learning is persistent and judge-gated, but data acquisition and domain-specific experiments remain owned by the web, MCP, sandbox, and tool providers rather than being invented by the ledger.
