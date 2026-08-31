# Agent Note: independent HARDNESS mission judge

Status: implemented

English | [中文](2026-08-30-hardness-independent-mission-judge.zh.md)

## Problem

A capability attempt could produce evidence without a durable decision proving that the mission objective was actually satisfied, leaving completion dependent on the executor's own claim.

## Decision

The HARDNESS mission runner locks the objective, deliverables, mandatory acceptance criteria, and quality requirements at mission start. Each criterion advances through `PENDING`, `IMPLEMENTED`, `TESTED`, and `VERIFIED` evidence states. The runner enters `VERIFYING` before it invokes an independent structured judge, which returns `pass`, `needs_changes`, or `blocked`, a bounded summary, criterion reviews, quality-gate findings, evidence references, and required changes.

The kernel accepts `pass` only when every mandatory criterion has evidence, the quality gate passes with evidence, and the decision covers the locked goal. An incomplete `pass` is persisted as `needs_changes`; it cannot set `DONE` or promote capability evidence. The only other terminal action is explicit user cancellation. The default judge starts a fresh subagent with a read-only tool allowlist and the configured LLM provider. It cannot edit files, execute commands, or start another agent. Provider unavailability, malformed output, or judge failure produces a waiting decision rather than a successful mission. Mission state replays as `ACTIVE`, `RECOVERING`, `WAITING_EXTERNAL`, `VERIFYING`, or `DONE`.

Attempt, plan, tool, and strategy failures remain discardable records. Repeated strategy fingerprints are quarantined, and the wall protocol records the cause, alternative routes, and missing dependencies for resumption. Prompt-like text in recent learning memory is inserted as literal content, so code containing `{{...}}` is not interpreted as a variable reference.

Disposable tool failures trigger bounded recovery: the failed capability is quarantined, ATLAS is searched again, and a different provider is tried when one exists. When the mission runs inside a durable goal, its identity is derived from the goal rather than the per-turn call id, so later rounds replay the same kernel. The judge may use read-only web search and fetch to compare product, interface, document, and visual work against relevant external standards before accepting quality.

The capability registry treats an identical same-version registration as an idempotent mount contribution and tracks its owners. A same-version descriptor with different semantics still fails loudly, while an older revision remains rejected. This lets a host projection and a resumed agent preset share one descriptor without hiding a real version collision.

The shipped `standard`, `code`, and `cordis` personas carry the same mission-completion rule. They prohibit a final response while a mandatory deliverable or verification remains, require a materially different strategy after a failed attempt, and preserve an unavoidable physical or human dependency as `WAITING_EXTERNAL`. The model requests only the minimal external action and may close the mission only after the independent judge passes with evidence or the user explicitly cancels it.

## Alternatives considered

**Trusting the executor's verification:** rejected because the same path that produced an artifact would also decide whether its own work passed.

**Closing after a successful tool call:** rejected because tool success does not establish that the user objective or quality criteria were met.

**Using the main agent as its own judge:** rejected because it does not provide an independent review context and can inherit the execution path's assumptions.

## Consequences

Successful missions require an available read-only judge provider and explicit evidence, while incomplete or externally blocked missions remain resumable instead of being falsely closed. A judge that requests changes returns the required repairs to the orchestrator, which can replan without promoting the current artifact. The extra review consumes a model call, but its bounded schema and tool list keep the decision auditable and prevent the reviewer from changing the work under review.

## Testing

Focused HARDNESS adapter tests cover passing, requested repairs, missing judges, unavailable providers, disposal, persisted kernel decisions, repeated strategy failures, and replay. Registry tests cover same-version idempotent registration and incompatible revision rejection. The assembled-preset test verifies the non-terminal mission rule in all three shipped personas. The adapter typecheck passes, and the generated persistence catalog passes its freshness check.
