# Agent Note: Adversarial completion verification

Status: implemented

English | [中文](2026-09-20-adversarial-completion-verification.zh.md)

## Problem

PHOENIX could produce a green self-authored test suite and still ship user-visible failures that the suite never exercised. A concrete external comparison exposed this failure mode: a generated calculator passed 44 tests while single-argument `max`/`min`, zero raised to a negative exponent, and deeply nested or unary input escaped as raw runtime exceptions or tracebacks. The suite proved its selected examples, not the absence of important failure classes.

## Decision

The fixed harness identity now makes completion evidence adversarial and entrypoint-based for every ordinary PHOENIX agent. Passing tests are evidence rather than proof. Before substantial work is declared complete, the agent exercises the real user-facing or production entrypoint and deliberately targets the highest-value applicable failure classes: empty/one/many cardinality, boundary and extreme values, malformed inputs, deep or large inputs, dependency failure, timeout/cancellation, and lifecycle/resource cleanup.

Broad input spaces should use property, fuzz, or metamorphic checks when those provide better coverage than a short example list. A directly observed failure overrides a green suite. User-controlled input must end in a valid result or a domain-classified failure; implementation exceptions, raw tracebacks, partial writes, and silent corruption do not cross the user-facing boundary. Internal diagnostics remain detailed.

Every discovered failure requires three things before completion: repair the root cause, add a regression test that would have caught it, and rerun the affected real entrypoint. Substantial deliverables use an independent verifier or fresh subagent when available so the author is not the sole judge of its own tests.

The repository AGENTS rule mirrors the runtime contract so coding agents follow the same standard while changing PHOENIX itself. The system-prompt test pins the critical language so weakening the contract is an explicit reviewed change.

## Consequences

- A green unit suite can no longer justify completion when the actual CLI, UI, API, executable, or other production entrypoint still fails.
- The calculator comparison's escaped `TypeError`, `ZeroDivisionError`, and `RecursionError` patterns become required adversarial classes rather than one-off bug patches.
- Verification effort stays proportional: agents select the highest-value applicable failure classes instead of exhaustively fuzzing every trivial change.
- Failures discovered by external evaluators feed back into PHOENIX as regression coverage and a stronger reusable completion policy.
