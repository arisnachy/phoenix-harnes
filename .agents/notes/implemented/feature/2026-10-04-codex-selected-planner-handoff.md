# Agent Note: Selected Codex planning with Luna execution

Status: implemented

English | [中文](2026-10-04-codex-selected-planner-handoff.zh.md)

## Problem

Phoenix's concrete Codex handoff recognized only Sol, Astra, and Terra as planners and derived older Luna workers from their generation. Other Codex selections never handed off or rescued a stalled worker. A separate medium-effort acquisition override also replaced an explicitly selected Luna planning effort.

## Decision

The opt-in `defaultExecutionHandoff` accepts every concrete OpenAI Codex selection. The selected model owns the first substantive step and rescues repeated failures or a new Team blocker; execution uses the active `gpt-6-luna` at Max. The first substantive step retains the selected effort, subject to the existing GPT-6 Luna Max rule. The low-cost conversational path remains unchanged.

The handoff remains explicit at the caller boundary. Direct consumers that omit it keep their selected route; other providers use their selected model for planning and execution. Phoenix Orquesta retains its separate automatic Sol planner and Luna executor policy. Real Team creation and teammate admission remain owned by Team composition and its tools.

Selector intent is stored in the model-hidden `agent/model-selection` event, separately from request headers that truthfully record the serving model. The event is required on read because losing it would change future model and cost decisions. Explicit accepted picks append changed preferences; the first dispatched request captures a default only when none exists, preserving blank-session default updates and avoiding overwriting a newer explicit pick with an older assembled request. Restored sessions therefore retain the original planner or synthetic router instead of treating the last Luna execution header as a new choice. The Web picker keeps the prior live route while flushing the proposed preference and acknowledges the new choice only after that durability barrier. A failed write appends a compensating preference with the prior default/explicit source and keeps the old live route. If the compensating flush also fails, the internal error states that durable storage is uncertain rather than reporting a model availability problem.

Existing Team workers refresh their next-request route from the lead's latest durable selector preference at waking mailbox delivery and directed human replies. Codex workers receive the Luna Max execution route; other providers retain the selected provider and model. The continuation owner persists the child's route and resolves it at request assembly, because later loop steps can otherwise reuse a prior serving header. Cold activation restores that durable route into AgentOptions as well as request configuration. Generic subagent followups without an explicit route retain the child's route. Safe-boundary human delivery lets an in-flight action finish before the refreshed route handles the reply.

## Alternatives considered

**Recognize only named premium model tiers.** This would leave selected Luna and unfamiliar Codex model ids outside the approved planning and rescue policy.

**Derive a matching Luna generation.** This would keep execution on older workers instead of the active Luna Max worker selected by the product design.

**Enable handoff for every installer caller.** This would change direct consumers that intentionally use one model throughout a turn.

## Consequences

The selected Codex model now determines planning and rescue quality while Phoenix's active Luna worker determines execution. Routing adds no classifier call or extra context. Durable-session tests also cover preference restoration and an explicit-choice race during assembly. Functional request-routing tests cover older Luna, older Sol, and unfamiliar Codex ids through planning, execution, stalled-worker rescue, and return to execution.
