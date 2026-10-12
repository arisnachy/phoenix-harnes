# Agent Note: Kira Max bounded execution and knowledge recovery

Status: implemented

English | [中文](2026-10-12-kira-max-bounded-execution.zh.md)

## Problem

The Kira Max persona names broad capabilities and team identities, but repeats routing instructions without connecting task decomposition to relevant memory, file ownership, stalled-team recovery or observable delivery. More instructions and more workers cannot establish better reasoning or shorter delivery time by themselves.

## Decision

The shipped [Kira Max composition](../../../../apps/cli/config/agent-presets/kira-max/agent.cordis.yml) carries one execution contract. Kira uses the existing HARDNESS workflow rubric, bounded project memory and relevant skills; `hardness_workflow` materializes a plan when useful and `hardness_run` provides governed mission execution or capability acquisition. Routine tasks retain direct execution. Retrieved memory is checked against current evidence, and verified lessons may enter durable memory without secrets.

Independent specialists receive fresh briefs with an objective, explicit ownership, constraints, relevant decisions, required evidence and completion criteria. Kira keeps the critical path, integrates results as they arrive, reuses existing specialists and stops redundant work. An isolated wait timeout is not a failed worker; after repeated unchanged waits Kira performs useful work or requests one bounded partial result. An inactive member is resumed with `followup_task`.

Existing model routing and team identities remain authoritative. The selected model owns Kira's planning and supervision; Codex specialists use the configured Luna Max profile, while other providers inherit the live selection. The preset explicitly retains the ordinary completion judge's adaptive budget: zero semantic passes for fast work, one for standard work and at most two for deep work. Formal HARDNESS mission gates retain their separate independent judge.

This preset contract complements the [durable Agent Teams decision](2026-08-05-agent-teams.md), [bounded Luna worker decision](2026-09-29-phoenix-auto-parallel-luna-worker.md) and [selected-planner handoff decision](2026-10-04-codex-selected-planner-handoff.md). Their runtime ownership and routing decisions remain unchanged.

## Alternatives considered

**Load all knowledge into every prompt.** Full historical ledgers and unrelated skills enlarge requests and may obscure current evidence. Bounded project retrieval preserves provenance and selects knowledge needed for the actual task.

**Change routing or disable all judges.** The existing routing already respects the selected provider and the ordinary judge already has a fast path. Replacing either would change working authority or quality contracts without a demonstrated defect.

**Increase worker count.** Additional workers without independent ownership duplicate investigation and create edit conflicts. The adaptive one-, two- and exceptional three-specialist ladder remains bounded.

## Consequences

This change strengthens model-facing execution instructions and exposes existing review defaults; it does not introduce a new scheduler, model capability or authority. Actual quality and latency still depend on the model, task and tools. No measured end-to-end speedup or parity with another assistant is claimed. Delivery reports distinguish implementation, testing, publication and live verification.

## Verification

The keyless Kira Max execution scenario loads the shipped configuration and uses the real AgentLoop, Spawn and Agent Teams path with a scripted provider. Focused memory, workflow and team routing tests cover the existing supporting contracts. Scripted execution verifies harness behavior and composition; it does not establish the quality of an authenticated model's reasoning.
