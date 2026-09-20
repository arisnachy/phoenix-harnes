# Agent Note: Steering preempts stale visible replies

Status: implemented

## Problem

A new human instruction can arrive while the current model request is already streaming a reply to an older prompt. Queueing that instruction until the next turn makes the composer acknowledge the send immediately while the assistant continues visibly answering the stale prompt, which reads as if the new instruction was ignored or arrived late. The Web client can also briefly render both its local optimistic submit and the Host-authoritative pending-steering projection for the same accepted send.

## Decision

Plain Enter defaults to `Steer` while a steer-capable primary session is running; the complementary Cmd/Ctrl+Enter gesture queues instead, and the persisted user preference can swap the pair. Idle submission remains an ordinary queued turn.

AgentLoop gives an active model request a stream-local abort owner in addition to the turn abort. Accepted human steering interrupts that active model request immediately, whether or not visible assistant text has appeared yet, and leaves the turn alive so the steering is claimed at the next step. If the superseded request had already emitted visible text, that prefix is recorded as an interrupted assistant message; if it had not emitted visible content, no synthetic assistant message is created. Tool execution keeps the existing step-boundary behavior, so already-running tool side effects are not canceled merely because the user typed again.

The Web client carries the submit mode through optimistic admission and reconciles a local steering submit against both the Host pending-steering mirror and the later durable steering message. One accepted human gesture therefore renders as one bubble throughout the local-to-Host-to-durable handoff.

## Verification

AgentLoop coverage pins both a model request that has not emitted visible text yet and a hanging visible-text stream, injects steering into each, and verifies that the next model request contains the steering without opening another turn. The visible-prefix case remains durable as interrupted output, while the pre-visible case creates no assistant message. Conversation tests pin the Steer-first keyboard policy and the single-bubble handoff between local optimistic state, Host pending steering, and the durable steering node. The assembled Web steering scenario exercises both the default gesture and the user-swapped Queue preference.

## Alternatives considered

**Always queue plain Enter while busy.** This preserves strict turn ordering but leaves a fresh human instruction behind a response the user is actively trying to redirect, reproducing the late-arrival behavior.

**Cancel the whole turn when steering arrives.** This reaches the new instruction quickly but can abort tools and partially completed side effects, which gives ordinary typing the semantics of the explicit Stop action.

**Wait for visible prose before interrupting the active model request.** Rejected because the exact failure can happen before the old reply has emitted its first visible token: the new bubble is already present, then stale prose appears afterward. A not-yet-dispatched tool call has no side effect to preserve, so preempting the model request is safe; already-running tools remain untouched.

**Fix only the Web presentation.** Hiding or reordering bubbles cannot make an already-running model request see an instruction it did not receive, so presentation-only changes do not solve the behavioral race.

## Consequences

A follow-up typed while a stale model request is active reaches the next model request without waiting for the superseded request to finish. Already-rendered text remains durable and explicitly interrupted; a request preempted before visible output leaves no assistant surface behind. The interruption can spend an additional model request and therefore some tokens, but it avoids continuing to spend output tokens on a reply the user has superseded. Already-running tool execution retains boundary-based steering, so the response is not guaranteed to switch at the exact keystroke when a non-interruptible side effect owns the step. Queue remains available through the complementary shortcut or the persisted preference.
