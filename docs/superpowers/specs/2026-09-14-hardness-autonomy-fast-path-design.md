# HARDNESS Autonomy Fast Path Design

## Goal

Phoenix selects the lightest sufficient execution process, completes routine work without ceremonial user approvals, and treats recoverable obstacles as reasons to change strategy rather than reasons to end the mission.

## Problem

Phoenix currently receives overlapping process guidance. `hardness_workflow` selects a cognitive pipeline, while the skill catalog independently tells the model to preload every apparently applicable skill. A bounded UI change can therefore load brainstorming, writing-plans, TDD, and verification before HARDNESS has selected its own process. The model-facing operating protocol also labels execution, verification, and presentation failures as `blocked`, even though the mission runtime and goal-round driver already support automatic recovery.

## Design

### 1. Deterministic execution mode

`CognitiveWorkflowPlan` exposes `executionMode: 'fast' | 'standard' | 'deep'`.

`fast` applies to bounded work whose complexity and risk are not high, novelty is low, and which has no external-evidence requirement, persistence obligation, prior failure, independent subtasks, or future obligation. Architecture, research, recovery, and mixed missions never enter the fast path.

`deep` applies when complexity, risk, or novelty is high, or when a previous attempt has failed. All other work is `standard`.

The fast path keeps intent framing, fresh verification, and outcome evaluation. It does not add brainstorming, architecture design, implementation planning, adversarial critique, or an independent judge merely because code changes or a user-visible artifact exist. Debug fast-path work may still use causal reasoning and systematic debugging. Low-risk fast-path code edits use targeted verification instead of mandatory proof-driven development; medium-risk bounded changes may still request proof-driven development.

### 2. HARDNESS owns process-skill selection

The skill catalog distinguishes domain skills from process or methodology skills in its model-facing guidance. When `hardness_workflow` is available, the model calls it before loading process skills for non-trivial work. The selected cognitive flows are authoritative process policy: process skills are loaded only when they directly implement a selected flow or are required by an already selected process skill. Domain skills remain available whenever the task needs them.

The cognitive workflow guide explicitly states that bounded cosmetic, wording, styling, and localized implementation changes are not architecture work and do not trigger brainstorming or implementation planning by default.

### 3. Fail-forward operating protocol

Recoverable failures remain active work:

- unresolved capability: inspect alternatives, acquire or build capability, then re-route;
- execution failure: inspect failure, select another route or repair/build the capability, and replan;
- verification failure: repair the implementation or verification method, then re-run fresh verification;
- presentation failure: select or build another renderer and verify again.

Only genuine external conditions may stop autonomous progress: explicit permission or credential requirements, user denial, safety policy, exhausted provider quota, or an external dependency Phoenix cannot satisfy safely.

The protocol never asks the user for routine file-location choices, implementation decisions, plan approval, or recovery approval when the available context and tools can resolve the decision.

### 4. Hard completion

Internal retry limits bound one attempt or execution window, not the mission. A mission may report DONE only after the requested deliverable exists, fresh verification passes, and the objective/acceptance criteria are satisfied. Text such as “implementation remains”, “next step is to implement”, partial scaffolds, or unverified progress cannot become a completion signal.

The existing goal-round driver remains the owner of persistent same-session continuation and strategy rotation. This change strengthens the instructions it receives; it does not create a second continuation engine.

## Safety and authority

The fast path removes ceremony, not safety. Explicit permissions remain authoritative. Workflow selection does not grant execution permission. Safety policy, credentials, provider quota, and genuinely external dependencies can still require waiting or user action.

## Acceptance criteria

1. A bounded low-novelty UI/code change is classified as `fast` and does not select brainstorming, architecture design, implementation planning, adversarial critique, or independent judge solely because it changes code or UI.
2. A high-risk, high-complexity, high-novelty, or previously failed mission remains `deep` and preserves the stronger review flows.
3. Skill-catalog guidance tells the model to obtain HARDNESS process policy before preloading methodology skills and to avoid unselected process ceremony.
4. Execution, verification, presentation, and missing-capability failures produce autonomous recovery actions instead of a terminal-style blocker when recovery is possible.
5. Approval denial and real permission requirements remain fail-closed.
6. Goal-round guidance explicitly treats process-skill approval ceremonies as subordinate to an already authorized active mission and continues until verified completion or a genuine external dependency.
7. Focused package tests prove the new workflow selection and protocol behavior, and the final PR preserves existing mainline behavior outside these areas.
