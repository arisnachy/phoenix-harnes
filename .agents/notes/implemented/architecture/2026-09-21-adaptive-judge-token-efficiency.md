# Agent Note: Adaptive judge and token efficiency

Status: implemented

## Problem

A follow-up external benchmark showed that PHOENIX moved ahead of the comparison harness by about 1.5 points, but consumed roughly twice as many model tokens. The quality gain was real, yet the cost profile was not acceptable.

The main cause was the ordinary completion bridge introduced with the previous quality work. Every verified substantive mutation could launch a fresh structured subagent. Although the spawn provider does not inherit the parent conversation history, it still creates a full child agent with the parent's model route, recomposes the preset/system prompt and allowed tool schemas, and by default creates an isolated Git worktree. The global completion prompt also told the worker to use a fresh independent verifier whenever no durable goal judge existed, so model-driven review could duplicate the bridge.

## Decision

Deterministic evidence and one silent in-band worker self-review are now the default completion path. After verification, the same worker compares the acceptance ledger with actual evidence and repairs obvious gaps before answering. A separate judge is not launched merely because work is substantive.

The ordinary independent judge is now adaptive. A zero-model-cost risk score escalates only when independence is likely to add information: the user explicitly asks for a judge/audit/second opinion, the work is security/high-impact, verification failed and later recovered, the mutation set is unusually broad, or a previous independent judge requested repairs and therefore requires re-review. Explicit error-contract and scale/resource requirements by themselves stay on the deterministic path because targeted tests/benchmarks plus self-review are cheaper first-line evidence.

The bridge also refuses to pay for semantic review before deterministic evidence is complete. If the request names an observable error contract or scaling/resource behavior, the corresponding targeted evidence must exist before a judge can run.

When an independent judge is justified, its context is intentionally small: request text is capped, mutation and verification summaries are bounded, the tool surface defaults to read/glob/grep/session evidence only, visual tools are added only for visual tasks, and web tools only for external/current comparisons. The judge child has a bounded token ceiling.

A dedicated `judge-spawn` provider disables Git worktree isolation because this judge is read-only. The normal `spawn` provider remains unchanged for workers and other subagents that may mutate state.

A `needs_changes` verdict still returns only concrete repairs to the original worker. After repair and fresh deterministic verification, one fresh judge pass is forced so the judge never certifies its own edits.

## Verification

Regression tests pin the risk policy, including the cheap path for explicit error-contract plus scale requirements, escalation for explicit independent/high-impact work and recovered verification failures, forced re-review after judge-requested repairs, the compact tool surface, conditional visual/web tools, and the judge token cap. The base bundle test pins `judge-spawn` with `worktreeIsolation: false`.

## Alternatives considered

**Remove the independent judge.** Rejected because the previous external benchmark showed a measurable quality gain and independent review remains valuable for high-risk, broad, or failed work.

**Always use a smaller/cheaper model for the judge.** Not chosen as the universal default because model availability and capability differ by provider. Adaptive invocation and bounded context reduce cost without silently changing the selected model family.

**Use the fork provider for cheaper review.** Rejected because fork inherits parent history by design, which weakens independence and can increase prompt-token reuse/carryover for a task whose goal is a fresh review.

**Keep judging every substantive mutation but cap output tokens.** Rejected because input/system/tool tokens and child setup still dominate enough of the cost that invocation frequency must be reduced, not only output length.

## Consequences

Low- and medium-risk tasks should retain the stricter requirement-aware verification introduced previously while avoiding a second model call. Independent review remains available exactly where its expected information gain justifies latency and tokens.

High-risk or recovery paths may still spend additional tokens, intentionally. The policy optimizes expected quality per token rather than minimizing tokens at the expense of verification.
