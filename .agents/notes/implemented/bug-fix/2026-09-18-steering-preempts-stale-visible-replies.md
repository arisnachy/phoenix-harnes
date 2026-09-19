# Agent Note: Steering preempts stale visible replies

Status: implemented

## Problem

A new human instruction can arrive while the current model request is already streaming a reply to an older prompt. Queueing that instruction until the next turn makes the composer acknowledge the send immediately while the assistant continues visibly answering the stale prompt, which reads as if the new instruction was ignored or arrived late. The Web client can also briefly render both its local optimistic submit and the Host-authoritative pending-steering projection for the same accepted send.

## Decision

Plain Enter defaults to `Steer` while a steer-capable primary session is running; the complementary Cmd/Ctrl+Enter gesture queues instead, and the persisted user preference can swap the pair. Idle submission remains an ordinary queued turn.

AgentLoop gives an active model request a stream-local abort owner in addition to the turn abort. Once that request has emitted visible assistant text, accepted steering interrupts only that model stream, records the already-visible prefix as an interrupted assistant message, and leaves the turn alive so the steering is claimed at the next step. Steering that arrives before visible assistant text or while tools are executing keeps the existing step-boundary behavior, so hidden preparation and tool side effects are not canceled merely because the user typed again.

The Web client carries the submit mode through optimistic admission and reconciles a local steering submit against both the Host pending-steering mirror and the later durable steering message. One accepted human gesture therefore renders as one bubble throughout the local-to-Host-to-durable handoff.

## Verification

AgentLoop coverage pins a hanging visible-text stream, injects steering after the first visible delta, and verifies that the next model request contains the steering without opening another turn. Conversation tests pin the Steer-first keyboard policy and the single-bubble handoff between local optimistic state, Host pending steering, and the durable steering node. The assembled Web steering scenario exercises both the default gesture and the user-swapped Queue preference.

## Alternatives considered

**Always queue plain Enter while busy.** This preserves strict turn ordering but leaves a fresh human instruction behind a response the user is actively trying to redirect, reproducing the late-arrival behavior.

**Cancel the whole turn when steering arrives.** This reaches the new instruction quickly but can abort tools and partially completed side effects, which gives ordinary typing the semantics of the explicit Stop action.

**Interrupt every active model stream before it emits visible text.** This minimizes latency further but can discard a request that is still constructing a tool call or other non-visible work. The chosen rule preempts stale prose while retaining the existing safe boundary before visible output exists.

**Fix only the Web presentation.** Hiding or reordering bubbles cannot make an already-running model request see an instruction it did not receive, so presentation-only changes do not solve the behavioral race.

## Consequences

A follow-up typed during visible stale prose reaches the next model request without waiting for that prose to finish, while already-rendered text remains durable and explicitly interrupted. The interruption can spend an additional model request and therefore some tokens, but it avoids continuing to spend output tokens on a reply the user has superseded. Tool execution and streams with no visible assistant text retain boundary-based steering, so the response is not guaranteed to switch at the exact keystroke when a non-interruptible operation owns the step. Queue remains available through the complementary shortcut or the persisted preference.
