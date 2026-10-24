# Agent Note: Kira narrates real work without blocking execution

Status: implemented

English | [中文](2026-10-24-kira-live-progress-feedback.zh.md)

## Problem

Phoenix could spend an entire multi-step task showing only a generic running label. The AgentLoop already inserted a model-visible reminder after twenty seconds of silent tool work, but it asked for an update only when a concrete milestone was available. Routine completed tool events were hidden inside a collapsed Tools disclosure, leaving the user without even an evidence-backed operational receipt while Kira continued.

## Decision

Kira's existing human-presence prompt now asks her to acknowledge a substantive task briefly before using tools, then provide natural, assistant-authored updates when evidence changes or the tool chain has been silent for roughly twenty seconds. The existing logged AgentLoop reminder asks for a concise truthful stage-and-next-check update even when no milestone exists, without an extra forced model call or a new execution permission. It does not expose private reasoning.

The conversation groups keep technical context and private tool arguments collapsed. Beneath the existing disclosure, the client now projects the number and latest category of *completed* tool operations from settled runtime results. When the latest tool result reports an error, the receipt says so. Running tools, context and reasoning cannot fabricate a completion receipt. Receipts are localized with the user's UI language; they are an objective fallback, not synthetic Kira speeches.

When a model speaks before invoking tools, the silence clock records the time of that actual message, not the time at which a lengthy tool finally returns. Kira's lead and specialist social contracts treat the user as a genuine teammate with final decision authority; no invented human or agent speech is permitted. The Team UI gives the human a localized collaborator role rather than a synthetic specialist avatar.

## Alternatives considered

**Generate autonomous commentary every few seconds.** Rejected: it would cost extra model calls, invent milestones without evidence, and interrupt long blocking tools.

**Expose every raw tool call and result.** Rejected: it would leak arguments and clutter conversation, especially for secure browser and credential workflows.

**Rely on the existing animated status alone.** Rejected: a generic "executing" label does not answer which actual stage was reached.

## Consequences

Conversation receives concise author-written explanations when the model complies, while verified tool receipts remain visible even for silent tool-only steps. The runtime still cannot narrate *inside* a single blocking tool invocation, but its subsequent update reminder no longer loses the elapsed time. The mechanism does not certify outcome success based on a tool call, alter permissions, or complete a mission prematurely.

## Testing

Focused UI tests cover settled-operation count, latest category, failures, private argument exclusion and no receipt for running or context-only activity. Human-presence, teammate-persona and user-role rendering tests pin consistent collaboration, authored-language, and non-fabrication requirements. CI typecheck, frontend build, documentation sync and real provider/harness playback are still required before promotion.
