# Agent Note: Kira user priority and actual model provenance

Status: implemented

English | [中文](2026-10-04-kira-user-priority-and-model-provenance.zh.md)

## Problem

A person addressing a busy teammate needs an answer without aborting its current action or losing the existing mission. A conversational answer is different from evidence that operational work finished. Kira also needs to show which real model produced each output while retaining her fixed visual identity; the selected router name cannot establish that model identity.

## Decision

An accepted Team user request enters the addressed child at the next safe step boundary. The child answers the person and continues its existing mission unless the person explicitly changes or cancels it. `team_chat_answer` publishes a bounded, idempotent answer to an accepted conversational request without completing the mission. Operational requests and affirmative operational claims require matching execution evidence. Reactions remain optional and cannot substitute for execution.

The existing [main conversation ownership](../feature/2026-10-01-kira-main-chat.md) remains responsible for durable participants, public output, delivery receipts, and reactions. This note owns the narrower safe-boundary and conversational-answer rules.

Kira keeps her fixed portrait. A small adjacent badge identifies actual output provenance: sun for Sol, moon for Luna, star for Astra, and lightning for other models, with the exact provider/model in its accessible label and tooltip. The client uses the durable `assistant/message` source for settled output. Streaming uses the prepared `request/header` configuration attached to the owning Step; a retry can replace that configuration, and an unchanged route carries into the next Step. Missing evidence produces no badge. Changing the selected route cannot relabel historical messages.

Conversation Definitions receive the engine-assigned immutable Location in the optional second argument of `match(event, location)`. The request-model Definition uses one Context per Step, so multiple headers during retry update one Location-data owner. Existing event-only match implementations remain valid; no global selected-model state participates in output provenance.

## Alternatives considered

**Interrupt the child immediately for every question.** This can abort an in-flight action before its receipt is available. A safe boundary preserves the action while admitting the person's request before further autonomous work.

**Complete the mission when the child answers.** A conversational acknowledgement cannot establish completion of the original assignment or a new operational request. Answer publication and execution evidence remain separate.

**Use the selected model or router name for every avatar.** A selector records routing intent, not the real model serving each request; applying it to old messages falsifies their provenance. The portrait remains stable and the badge follows actual per-output facts.

**Publish one request-model Context per header.** Multiple retry headers in one Step would compete for the same Location-data key. One Step-owned Context admits updates without ownership collisions or mutable global bookkeeping.

## Consequences

Human Team interventions preserve work already in progress and remain durably correlated to accepted delivery. Explicit answers do not release operational evidence requirements. Model identity appears beside Kira without replacing her portrait or exposing credentials. The engine's additive Location argument lets existing definitions correlate events lacking embedded turn/step identifiers while preserving history paging and reference stability.

## Verification

Team service and tool tests pin accepted-request authority, safe-boundary delivery, conversational-answer idempotency, rejection of operational answers without evidence, and optional reactions. Client assembler and author tests pin Sol/Luna/Astra/other badges, absent provenance, same-Step retry header changes, unchanged-route carryover, final-source precedence, and historical identity after later headers and history replay/prepend. The broader chat-view suite passes all 64 tests after correcting outdated fixture inputs and disclosure/lifecycle assumptions, preserving assertions for durable handoff, slot ownership, and turn actions. Non-Codex providers retain the other-provider badge even when a model ID contains a Codex family name. Human reaction rows do not inherit the mobile avatar indentation.
