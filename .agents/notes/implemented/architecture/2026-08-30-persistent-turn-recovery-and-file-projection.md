# Agent Note: persistent turn recovery and file projection

Status: implemented

English | [中文](2026-08-30-persistent-turn-recovery-and-file-projection.zh.md)

## Problem

A provider turn that reached its output-token ceiling could look like a completed driver cycle, and durable non-image attachments could be admitted by the composer but omitted from the provider request.

## Decision

`max-tokens` is an attempt-level terminal reason, not a mission result. When an active armed goal receives that reason, the round driver releases the current reservation, persists a retrying supervisor checkpoint after the session event finishes publishing, and schedules another bounded round. The mission remains active and the next round can select a different strategy. The model loop still retains the `max-tokens` event and does not dispatch truncated tool calls.

The pi-ai adapter resolves every file reference from the durable attachment store before constructing a request. Text-like files are decoded as bounded UTF-8 text with stable metadata and an explicit truncation marker; binary files are represented by a named descriptor without unsafe decoding. A missing or inconsistent durable reference fails loudly, while a valid file never disappears from model-visible content.

The agent loop also turns every ordinary failed tool result into a durable recovery instruction for the next model step. The instruction points the model to the exact logged result, requires diagnosis and a changed strategy, and forbids treating the attempt as a mission failure or asking for routine approval. Explicit cancellation results remain cancellation-only and do not schedule recovery work.

The model-facing `hardness_run` adapter applies the same rule to governed capability blocks. A blocked result is non-terminal and exposes `mission_status` plus `next_action`; it also defers a durable `WALL_PROTOCOL` recovery instruction. This prevents a failed tool, strategy, or approval path from being mistaken for a completed mission or from triggering an invalid `exit_plan_mode` call outside plan mode.

## Alternatives considered

**Remove `max-tokens`:** rejected because the provider still needs an output bound and unbounded responses can truncate at another layer or consume uncontrolled resources.

**Treat `max-tokens` as mission failure:** rejected because one incomplete model attempt is recoverable and must not close a durable mission.

**Rely only on prompt wording after a tool error:** rejected because the next model request must carry an explicit, logged recovery instruction even when the provider returns an error result without an agent-level exception.

**Inline every file without a bound:** rejected because arbitrary attachments can exhaust request memory and context; text projection is bounded and binary bytes are not decoded.

## Consequences

Long-running goals continue after a token-limited attempt while preserving the exact failure reason and checkpoint. The model receives names and bounded content for text attachments and a durable descriptor for binary attachments. Provider-native file parts remain outside this adapter's protocol-neutral contract.

## Testing

The goal driver suite verifies that a token-limited turn remains active, persists recovery state, and admits a later round. The agent-loop tool-call suite verifies failed tool results add a recovery instruction and continue in the same session. The pi-ai context suite verifies text, truncation, and binary attachment projection. The assembled standard preset e2e and repository typecheck pass after the change.
