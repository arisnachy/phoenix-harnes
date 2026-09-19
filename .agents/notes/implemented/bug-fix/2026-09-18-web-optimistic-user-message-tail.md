# Agent Note: Keep optimistic user messages at the transcript tail

Status: implemented

English | [中文](2026-09-18-web-optimistic-user-message-tail.zh.md)

## Problem

The composer already exposed a local pending-submit projection so Enter could be visible before Host admission completed, but ChatView rendered that projection before the durable chat flow. A newly sent user bubble therefore appeared above loaded history and could remain off-screen until the Host emitted the durable `user/message`; at that point the optimistic row disappeared and the same message reappeared at its durable position, making the transcript look as though it reordered itself after a delay. The handoff also treated any user row inside the one-second Host/browser clock-jitter allowance as the submitted message, so an unrelated recent prompt could suppress the optimistic bubble.

The input shell also imposed its own eight-second text-admission watchdog below the carrier's bounded unary request. When that timer fired it aborted the request signal, restored the draft, and told the user to try again. An abort only proves that the browser stopped waiting; it does not prove that the Host failed to append or queue the message. A late Host acceptance followed by the encouraged retry could therefore leave the same user gesture once in the transcript and once again in the pending Queue.

## Decision

Ordinary pending submits are rendered by the chat-flow owner at the transcript tail, after all currently durable nodes and before the current running-turn status. The projection remains presentation-only: it does not enter the session log, model context, tool routing, memory, retrieval, or provider request. When the corresponding durable `user/message` arrives, the optimistic projection disappears and the keyed durable row occupies the same reading tail, so there is no head-to-tail visual jump.

Durable handoff keeps the existing one-second clock-jitter allowance but requires the candidate user row's plain-text projection to match the model-facing text of the pending submit. The input shell records both the display draft and, after reference serialization, the exact serialized text sent to the Host; ordinary text uses the same value for both. This prevents an unrelated nearby prompt from hiding the new bubble and lets reference-bearing prompts hand off even though their display text differs from the durable model-facing form.

Text admission no longer has a second UI-layer timeout. The original request signal stays live until the carrier returns a success/failure or the input shell is actually disposed. While that admission is unresolved, the machine retains the submit slot, so repeated Enter cannot create a second occurrence. Transport health remains owned by the carrier's bounded unary deadline; the UI does not convert an ambiguous local timeout into a retry instruction.

Bottom-follow includes the pending admission start in its flow-tip signature. A reader already pinned to the bottom therefore sees the optimistic row as soon as React publishes it, while a reader who intentionally left the bottom keeps ownership under the existing scroll ledger.

## Testing

`packages/client/ui-conversation/tests/chat-view.client.spec.tsx` starts with a prior user row inside the jitter window plus a settled assistant row, publishes a new pending submit, and asserts that the optimistic bubble exists after the prior answer. It then appends the durable user row and asserts a single copy remains at the same tail ordering. This one scenario fails both the old head insertion and the old unrelated-row jitter match.

The reference-submit and InputBar specs also hold a prompt admission unresolved past the former eight-second cutoff, assert that its AbortSignal remains live, that no retry error is emitted, and that a second submit is suppressed until the original admission settles. A separate ChatView case pins handoff of a display reference through its serialized model text.

The assembled web replay lane remains authoritative for durable transcript and streaming behavior. This change does not alter durable events or model-visible output; its new state exists only during the local admission interval, so the package tests own the transient handoff while the existing web replay continues to cover the settled transcript.

## Alternatives considered

**Wait for the durable Host row.** Rejected because it removes the visual reorder but restores the send-latency regression: the user receives no message acknowledgement until transport admission finishes.

**Keep the optimistic row before the durable flow and scroll to it.** Rejected because scrolling would only expose the wrong chronology. A pending message belongs after the history it follows, not above it.

**Match every row inside the clock-jitter window.** Rejected because rapid consecutive sends can place an unrelated prior user row inside that window and falsely mark the new submission durable.

**Abort admission after eight seconds and invite a retry.** Rejected because cancellation of the browser wait is not a transactional rollback of Host admission. Retrying after an ambiguous abort can duplicate a message that the Host already accepted.

**Move admission or model work onto a lower-quality fast path.** Rejected because the defect is presentation ordering, not model execution. Response quality, retrieval, memory, tools, provider routing, and streaming stay unchanged.

## Consequences

A send is acknowledged at the correct reading position without waiting for Host durability, and the optimistic-to-durable transition no longer visually reorders the conversation. Slow admission can remain protected by the carrier deadline instead of being locally aborted into a duplicate-retry window; during that interval the submitted bubble is visible and the same machine slot prevents resubmission. The trade-off is that a genuinely stuck carrier can keep that one composer transaction locked until its bounded request settles, rather than falsely declaring failure at eight seconds. The fix adds no model token work and no extra subagent or retrieval path. Durable history remains the source of truth after handoff.
