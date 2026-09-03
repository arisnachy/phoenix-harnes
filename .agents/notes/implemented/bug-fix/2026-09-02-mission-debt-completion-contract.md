# Agent Note: Mission debt completion contract

Status: implemented

## Problem

Executable PHOENIX missions could perform real tool work and then end a top-level turn with prose such as `Pendiente:`, `Pending:`, or `not yet`, even though the requested deliverable was still incomplete. The generic agent loop correctly treats a prose-only model response as a completed turn, but without an active durable goal that turn boundary could become the user-visible end of the mission. HARDNESS could also surface missing technical capabilities as a blocker even when PHOENIX could continue by changing route, acquiring a capability, or building a governed helper.

## Decision

The goal-round driver installs a stop-boundary mission-debt fence through the existing `agent/turn-stopping` extension point. For a direct human turn that actually executed a tool, an explicit unresolved-work statement in the final assistant message bootstraps the exact human objective into an active durable goal before the turn can settle. Ordinary informational turns and executable turns that explicitly report no remaining debt are left unchanged.

The durable goal remains the continuation authority. Round limits bound one execution window rather than the mission: the driver rotates the goal revision and strategy, persists supervisor state, recovers from provider errors and token limits, and continues until the existing completion gate and independent judge accept the result or the goal is explicitly paused/cancelled under its normal authority rules.

At the HARDNESS tool boundary, missing technical capability, execution surface, or executor is classified as `RECOVERING` internal mission debt. Recovery instructions require PHOENIX to inspect existing capability and connector inventories, try a materially different route, acquire or build the smallest governed helper the runtime permits, test it before use, and retain failure-to-solution learning. `WAITING_EXTERNAL` is reserved for dependencies PHOENIX cannot create or satisfy itself, such as direct human authorization, a credential controlled only by the human, required physical action, or unavailable external infrastructure.

The existing adversarial completion gate, artifact fingerprint, clean-room verification, mandatory evidence ledger, and independent judge remain the only path to successful completion. This change does not weaken those gates and does not modify the generic agent loop.

## Verification

Focused unit coverage proves Spanish and English unresolved-work forms, explicit no-debt statements, the requirement for real tool execution, and direct-human authority. An integration test drives the real agent-loop lifecycle through a Hostinger-style partial handoff and verifies that the turn creates a persistent goal instead of silently settling. HARDNESS regression coverage verifies technical blocker reclassification while preserving genuine human/external blockers. Repository CI supplies static, coverage, snapshot/artifact, Windows, Node compatibility, Python keyless, release, and updater/channel verification.

## Alternatives considered

**Prompt-only persistence.** Rejected because HARDNESS already instructed the model not to stop on partial work; the defect was an enforcement gap at a lifecycle boundary, so stronger prose alone could still be ignored.

**Change the generic agent loop to reject every prose-only completion.** Rejected because informational and conversational turns legitimately finish without tool calls. Persistence belongs in the goal plugin and existing lifecycle extension point, not in a global loop heuristic.

**Treat every blocker as external.** Rejected because missing tools, executors, and technical surfaces are frequently solvable by PHOENIX itself. Only dependencies outside PHOENIX's authority justify waiting for a human or external system.

## Consequences

PHOENIX now converts explicit executable mission debt into durable continuation instead of presenting it as a terminal handoff. The guard is intentionally conservative: it requires a direct human objective, real tool execution in the same turn, and explicit unresolved-work evidence, reducing accidental goal creation for ordinary chat. Technical capability failures can consume additional recovery rounds and tool work, but that cost is deliberate because bounded attempts are disposable while the mission objective remains durable. Completion quality remains fail-closed behind the pre-existing independent evidence and judge gates.
