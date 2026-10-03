# Agent Note: Durable proactive mail and reaction recovery

Status: implemented

English | [中文](2026-10-02-phoenix-durable-assistant-delivery.zh.md)

## Problem

Proactive mail can finish without confirmed delivery when a condition is met, or duplicate an accepted message after interrupted recovery outlives the provider's idempotency window. Unverified mailboxes turn recoverable setup into failed tasks after model work. Direct sends are absent from mailbox teardown. Historical Team reactions disappear visually when valid old projection checkpoints skip their new fold, and comparing distinct branded reactor identities prevents compilation.

## Decision

Replies and new messages use one durable outbox. Each occurrence retains its immutable recipient, body, subject where applicable, first attempt and provider confirmation. Recovery checks delivery before model work and reuses the confirmed payload. Pending verification and transport confirmation defer execution; expired ambiguity requires human review and is excluded from automatic retries. Condition-triggered mail reaches the same confirmed delivery path before becoming terminal. Explicit user sender identity retains its connected-account route.

Mailbox disposal rejects new sends, aborts owned transport requests and awaits admitted operations plus outbox cleanup. New outgoing messages persist their owning task and occurrence; every attempt revalidates the current task, sender identity, recipient and occurrence before transport. Paused, cancelled, completed or missing tasks suppress delivery without erasing ambiguity evidence. Provider authentication and authorized recipients remain required on every send attempt. Reaction projection version 2 rejects older checkpoints and replays real historical events; the conversion between session and Team identity follows the root Team identity rule. Display names and model routing retain their existing meanings.

## Alternatives considered

A provider key without persisted content and attempt time does not guarantee delivery across long outages. Treating mailbox verification as a permanent failure wastes model work and prevents recovery. Keeping the reaction projection version would accept snapshots that omit historical reactions; preserving a second renderer would duplicate presentation instead of repairing replay.

## Consequences

Regression tests cover confirmed recovery without another model call, exact 24-hour ambiguity parking, conditional delivery, pending setup, immutable output, cancellation and disk checkpoint replay. Existing browser acceptance scenarios exercise the assembled mail and Team transcript. Actual mailbox signup, owner verification and Windows login startup require activation on the owner's PC; bounded keyless checks do not prove live provider entitlement.
