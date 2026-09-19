# Agent Note: Keep optimistic user messages at the transcript tail

Status: implemented

English | [中文](2026-09-18-web-optimistic-user-message-tail.zh.md)

## Problem

The composer already exposed a local pending-submit projection so Enter could be visible before Host admission completed, but ChatView rendered that projection before the durable chat flow. A newly sent user bubble therefore appeared above loaded history and could remain off-screen until the Host emitted the durable `user/message`; at that point the optimistic row disappeared and the same message reappeared at its durable position, making the transcript look as though it reordered itself after a delay. The handoff also treated any user row inside the one-second Host/browser clock-jitter allowance as the submitted message, so an unrelated recent prompt could suppress the optimistic bubble.

## Decision

Ordinary pending submits are rendered by the chat-flow owner at the transcript tail, after all currently durable nodes and before the current running-turn status. The projection remains presentation-only: it does not enter the session log, model context, tool routing, memory, retrieval, or provider request. When the corresponding durable `user/message` arrives, the optimistic projection disappears and the keyed durable row occupies the same reading tail, so there is no head-to-tail visual jump.

Durable handoff keeps the existing one-second clock-jitter allowance but narrows its backward-time match. A user row timestamped at or after the browser admission start is accepted as the Host echo; an earlier row inside the allowance is accepted only when its plain-text projection matches the pending text. This prevents an unrelated immediately preceding prompt from hiding the new bubble while retaining tolerance for small Host/browser clock skew.

Bottom-follow includes the pending admission start in its flow-tip signature. A reader already pinned to the bottom therefore sees the optimistic row as soon as React publishes it, while a reader who intentionally left the bottom keeps ownership under the existing scroll ledger.

## Testing

`packages/client/ui-conversation/tests/chat-view.client.spec.tsx` starts with a prior user row inside the jitter window plus a settled assistant row, publishes a new pending submit, and asserts that the optimistic bubble exists after the prior answer. It then appends the durable user row and asserts a single copy remains at the same tail ordering. This one scenario fails both the old head insertion and the old unrelated-row jitter match.

The assembled web replay lane remains authoritative for durable transcript and streaming behavior. This change does not alter durable events or model-visible output; its new state exists only during the local admission interval, so the package test owns the transient handoff while the existing web replay continues to cover the settled transcript.

## Alternatives considered

**Wait for the durable Host row.** Rejected because it removes the visual reorder but restores the send-latency regression: the user receives no message acknowledgement until transport admission finishes.

**Keep the optimistic row before the durable flow and scroll to it.** Rejected because scrolling would only expose the wrong chronology. A pending message belongs after the history it follows, not above it.

**Match every row inside the clock-jitter window.** Rejected because rapid consecutive sends can place an unrelated prior user row inside that window and falsely mark the new submission durable.

**Move admission or model work onto a lower-quality fast path.** Rejected because the defect is presentation ordering, not model execution. Response quality, retrieval, memory, tools, provider routing, and streaming stay unchanged.

## Consequences

A send is acknowledged at the correct reading position without waiting for Host durability, and the optimistic-to-durable transition no longer visually reorders the conversation. The fix adds no model token work and no extra subagent or retrieval path. The only additional render input is the pending-submit timestamp already present in InputState; durable history remains the source of truth after handoff.
