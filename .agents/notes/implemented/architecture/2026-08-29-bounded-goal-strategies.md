# Agent Note: Bounded goal strategy selection

Status: implemented

English | [中文](2026-08-29-bounded-goal-strategies.zh.md)

## Problem

The goal driver could ask for a different approach after an unsuccessful round, but it did not record which recovery strategy it selected. A later process could not distinguish a deliberate strategy change from ordinary prompt text.

## Decision

The goal domain owns a log-only `goal/strategy` event. Before each continuation prompt, the driver selects and records one of four fixed strategies: `baseline`, `verification-first`, `alternate-tool`, or `minimal-change`. Selection is deterministic from the previous durable strategy and the admitted round count, and the immediate previous strategy is never selected again. The selected id is included in the canonical prompt and reconstructed by the invariant from the event immediately preceding that prompt.

## Alternatives considered

- **Let the model invent an unlogged strategy name.** Rejected because the recovery choice would not be bounded or replayable.
- **Choose randomly.** Rejected because nondeterministic prompts make replay and debugging unreliable.
- **Persist only the prompt text.** Rejected because it does not provide a typed operational record for supervisor diagnostics.

## Consequences

Every automatic round has an auditable strategy decision, and repair prompts can prove that a material change was requested. The finite rotation is intentionally conservative; a human resume or a later policy can restart the sequence after a new goal revision.
