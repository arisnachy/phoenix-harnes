# Agent Note: Execution efficiency and completion-quality bridge

Status: implemented

English | [中文](2026-09-20-execution-efficiency-quality-bridge.zh.md)

## Problem

External A/B runs exposed a shared failure mode: PHOENIX spent latency on process overhead while still allowing incomplete evidence to count as completion.

The same model, reasoning level, and task took 20m20s in PHOENIX versus 8m18s in Codex. Workspace confirmation followed by a root `glob("*")` could consume the full recursive-search timeout even when exact target paths were already known. Ordinary mutation tasks could also bypass HARDNESS mission/goal judges. Separately, a generated task-graph implementation passed all 16 supplied tests while still violating an explicit `CycleError` message contract and retaining O(n²) critical-path state.

## Decision

HARDNESS routing is zero-round by default. The deterministic routing rubric is applied during intent framing; `hardness_workflow` remains available only when a serialized plan must be materialized or adapted after new evidence changes the mission.

Resource resolution is exact-path first. Session cwd is authoritative, known or observed paths are read directly, scoped discovery follows misses, and workspace-wide basename globs are a last resort rather than an orientation step. Existing filesystem observation state remains the single file-version ledger.

The read-only `glob` and `grep` tools opt into the existing concurrency-safe scheduler. Shell execution remains conservative and exclusive unless another subsystem explicitly proves safety.

Quality-policy now tracks explicit request signals that require targeted evidence. A generic green suite cannot close an explicitly requested public-error contract or scaling/resource requirement. HARDNESS software quality contracts require criterion-to-evidence mapping, observable error-contract verification, and bounded scale/resource evidence when those properties are material.

Ordinary substantive code, web, and configuration mutations receive a bounded read-only independent completion review after deterministic verification. A `needs_changes` verdict steers the original worker with the concrete repair list; the judge cannot mutate files or execute commands. The ordinary judge is bounded to two passes by default.

## Verification

The implementation adds regression coverage for requirement-signal detection, search-tool parallel execution, error/scaling quality requirements, and the read-only completion judge. The PR also relies on the repository's main guard, typecheck/build, and targeted package tests before merge.

## Alternatives considered

**Add a second known-file cache.** Rejected because `fs-observation-policy` already owns per-session file observations and versions; duplicating that state would create synchronization risk without reducing the fundamental discovery round.

**Ban broad globbing entirely.** Rejected because exhaustive basename search is legitimate for some user requests. The change makes broad root discovery a last resort instead of removing the capability.

**Run the independent judge after every turn.** Rejected because it would add latency and cost to read-only and conversational work. The judge is gated to substantive verified mutations and bounded to a small number of passes.

**Move the behavior into agent-loop.** Rejected because the repository keeps the central loop minimal. The completion bridge lives in HARDNESS adapters and uses existing hooks.

## Consequences

The compliant fast path removes one mandatory model round and allows independent read-only searches to overlap. Exact known targets no longer need cwd confirmation or global rediscovery. Completion quality is stricter for explicit error contracts and scaling/resource requirements, including cases where aggregate tests pass.

The trade-off is one independent semantic review after substantive verified mutations and extra targeted verification when the request itself names properties that a generic test suite cannot prove. That additional work is bounded and occurs only where it contributes direct evidence to completion quality.
