# Agent Note: Adversarial completion verification

Status: implemented

English | [中文](2026-09-20-adversarial-completion-verification.zh.md)

## Problem

PHOENIX could produce a green self-authored test suite and still ship user-visible failures that the suite never exercised. A concrete external comparison exposed this failure mode: a generated calculator passed 44 tests while single-argument `max`/`min`, zero raised to a negative exponent, and deeply nested or unary input escaped as raw runtime exceptions or tracebacks. The suite proved its selected examples, not the absence of important failure classes.

## Decision

The fixed harness identity now makes completion evidence adversarial and entrypoint-based for every ordinary PHOENIX agent. Passing tests are evidence rather than proof. Before substantial work is declared complete, the agent exercises the real user-facing or production entrypoint and deliberately targets the highest-value applicable failure classes: empty/one/many cardinality, boundary and extreme values, malformed inputs, deep or large inputs, dependency failure, timeout/cancellation, and lifecycle/resource cleanup.

Broad input spaces should use property, fuzz, or metamorphic checks when those provide better coverage than a short example list. A directly observed failure overrides a green suite. User-controlled input must end in a valid result or a domain-classified failure; implementation exceptions, raw tracebacks, partial writes, and silent corruption do not cross the user-facing boundary. Internal diagnostics remain detailed.

Every discovered failure requires three things before completion: repair the root cause, add a regression test that would have caught it, and rerun the affected real entrypoint. Substantial multi-step deliverables use a durable goal and its independent completion judge when available; otherwise they use a fresh independent verifier so the author is not the sole judge of its own tests.

PHOENIX also mounts `@phoenix-ai/dsh-quality-policy` in the base bundle as a mechanical low-latency freshness guard. It keeps an O(1), per-agent task ledger: successful mutations advance an evidence generation; verification observed afterward marks only that generation fresh; later mutations invalidate it. The first fresh-to-dirty transition adds a short in-band `additionalContexts` notice to work that is already continuing, so the compliant path adds no model round. If a turn still attempts to stop dirty, `agent/turn-stopping` may steer one bounded correction by default. Domain hints require automated evidence for code, web, and config while allowing final inspection for docs, data, and generic artifacts. The reminder explicitly prefers deterministic checks before model review, parallel independent checks, reuse of unchanged evidence, real consumer entrypoints, and extra verification only when expected quality gain justifies latency or cost. Generation freshness is deliberately used instead of content hashing so the hot path performs no extra filesystem I/O; a durable cross-task failure index remains the learning subsystem's responsibility.

The repository AGENTS rule mirrors the runtime contract so coding agents follow the same standard while changing PHOENIX itself. The system-prompt test pins the critical language so weakening the contract is an explicit reviewed change.

## Alternatives considered

**Rely on prompt guidance alone.** This adds no runtime machinery, but the benchmark failure showed that self-authored checks can still leave stale or incomplete evidence unchallenged.

**Run an independent model judge after every task.** This would strengthen review but adds latency and token cost even when deterministic evidence is already fresh. The shipped policy reserves model judging for substantial work and uses a local O(1) freshness ledger on the normal path.

**Hash every changed artifact after each tool call.** Content-addressed evidence is precise, but unconditional filesystem reads add I/O and couple the guard to storage semantics. Generation freshness is conservative, cheap, and provider-neutral; authoritative hashes can replace it later when mutation tools expose them without extra reads.

## Consequences

- A green unit suite can no longer justify completion when the actual CLI, UI, API, executable, or other production entrypoint still fails.
- The calculator comparison's escaped `TypeError`, `ZeroDivisionError`, and `RecursionError` patterns become required adversarial classes rather than one-off bug patches.
- Verification effort stays proportional: agents select the highest-value applicable failure classes instead of exhaustively fuzzing every trivial change.
- Failures discovered by external evaluators feed back into PHOENIX as regression coverage and a stronger reusable completion policy.
