# HARDNESS Autonomy Fast Path Design

## Goal

Phoenix selects the lightest sufficient execution process, completes routine work without ceremonial user approvals, and treats recoverable obstacles as reasons to change strategy rather than reasons to end the mission.

## Problem

Phoenix receives two model-facing sources that can overlap: `hardness_workflow` selects a cognitive pipeline, while the generic skill catalog advertises reusable skills. A bounded UI change can therefore tempt a model to preload brainstorming, writing-plans, TDD, and review before HARDNESS has selected the process. The operating protocol also needs to distinguish recoverable execution failures from genuine external blockers.

## Design

### 1. Deterministic execution mode

`CognitiveWorkflowPlan` exposes `executionMode: 'fast' | 'standard' | 'deep'`.

`fast` applies to bounded work whose complexity and risk are not high, novelty is low, and which has no external-evidence requirement, persistence obligation, prior failure, independent subtasks, or future obligation. Architecture, research, recovery, and mixed missions never enter the fast path.

`deep` applies when complexity, risk, or novelty is high, or when a previous attempt has failed. All other work is `standard`.

The fast path keeps intent framing, safe change when code is modified, fresh targeted verification, and outcome evaluation. It does not add brainstorming, architecture design, implementation planning, adversarial critique, or an independent judge merely because code changes or a user-visible artifact exist. Debug fast-path work still uses causal reasoning and systematic debugging.

### 2. HARDNESS owns process policy

The generic skill catalog remains generic and unchanged. The higher-priority HARDNESS system-prompt guide declares selected HARDNESS flows to be the process policy for the mission. Process or methodology skills are loaded only when they implement a selected HARDNESS flow or are required by an already selected process skill. Domain skills remain available whenever the task needs them.

The cognitive workflow guide explicitly states that bounded cosmetic, wording, styling, and localized implementation changes use fast mode and do not trigger brainstorming or implementation planning by default. New risk, scope expansion, failure, or another real trigger can escalate the workflow automatically.

### 3. Fail-forward operating protocol

Recoverable failures remain active work:

- unresolved capability remains execution-blocked, but Phoenix must inspect alternatives and attempt acquisition/build recovery before a routine user handoff;
- execution failure continues through failure inspection, an alternative route, repair/build, and replanning;
- verification failure continues through repair and fresh verification;
- presentation failure continues through renderer selection, repair, acquisition/build, and rendering again.

Only genuine external conditions may stop autonomous progress: explicit permission or account authorization, user denial, safety policy, exhausted provider quota, or an external dependency Phoenix cannot satisfy safely.

The protocol never asks the user for routine file-location choices, implementation decisions, plan approval, or recovery approval when the available context and tools can resolve the decision.

### 4. Hard completion

Internal retry limits bound one attempt or execution window, not the mission. A mission may report DONE only after the requested deliverable exists, fresh verification passes, and the objective/acceptance criteria are satisfied. Partial scaffolds, mocks, progress narration, or “next step is to implement” cannot become a completion signal.

The existing mission orchestrator and goal-round driver remain the owners of automatic recovery, persistent continuation, and strategy rotation. This change strengthens their policy; it does not create a second continuation engine.

## Safety and authority

The fast path removes ceremony, not safety. Explicit permissions remain authoritative. Workflow selection does not grant execution permission. Safety policy, account authorization, provider quota, user denial, and genuinely external dependencies can still require waiting or user action.

## Acceptance criteria

1. A bounded low-novelty UI/code change is classified as `fast` and does not select brainstorming, architecture design, implementation planning, adversarial critique, or independent judge solely because it changes code or UI.
2. A high-risk, high-complexity, high-novelty, or previously failed mission is `deep` and preserves stronger review flows.
3. HARDNESS prompt guidance makes selected flows authoritative for process skills without coupling or mutating the generic skill catalog.
4. Execution, verification, and presentation failures produce autonomous recovery actions rather than a terminal blocker when recovery is possible.
5. Missing/unknown capability routes remain fail-closed for execution while requiring alternative/acquisition/build recovery before routine user handoff.
6. Approval denial and real permission requirements remain fail-closed.
7. Goal-round guidance treats process-skill/plan ceremonies as subordinate to an already authorized active mission and continues until verified completion or a genuine external dependency.
8. Focused package tests plus a keyless real-Loader snapshot prove the model-visible policy, and the final PR preserves concurrent mainline changes.
