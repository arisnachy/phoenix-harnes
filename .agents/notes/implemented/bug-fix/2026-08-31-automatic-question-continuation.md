# Agent Note: automatic question decisions continue missions

Status: implemented

English | [中文](2026-08-31-automatic-question-continuation.zh.md)

## Problem

When the one-minute question deadline selected a recommendation, the answer had the same wire form as a human answer. A model could therefore treat the decision as the end of the work, and the supervisor had no explicit signal to distinguish a timeout decision from mission completion.

## Decision

Deadline answers carry `automatic: true` through the host, browser, service, and model-facing tool result. Human answers keep the existing shape. The question tool and every goal continuation prompt state that this marker resolves only the current decision: it never completes, cancels, or blocks an active mission. The selected recommendation remains deterministic and safety-first.

## Alternatives considered

**Treat a timeout as cancellation.** Rejected because a missing human response is not evidence that the requested objective failed.

**Keep the answer unmarked and rely only on prompt wording.** Rejected because the model-visible tool result must carry the decision provenance across turns and replay.

**Automatically approve every unanswered confirmation.** Rejected because high-impact and ambiguous actions require the existing conservative fallback.

## Consequences

Phoenix can use the recommended choice without waiting indefinitely, while the active mission remains eligible for continued execution and strategy changes. The marker is persisted in the tool result, so a resumed transcript retains why the choice was made. It does not weaken judge, evidence, or completion gates.

## Testing

Focused user-question, tool, host-proxy, UI-composer, plan-review, and goal-driver tests pass. The tool regression verifies that `automatic: true` does not set `concludesTurn`; the host and UI regressions verify the marker is emitted at the deadline.
