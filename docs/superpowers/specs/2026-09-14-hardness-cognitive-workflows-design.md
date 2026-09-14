# HARDNESS Cognitive Workflow Engine Design

## Goal

Give PHOENIX a provider-neutral cognitive workflow layer that lets the harness know which reasoning and engineering flows it has, when each flow applies, how flows compose, and which evidence is required before a mission may advance. The harness should make the whole system more capable than any single model by combining persistent state, multiple agents, dynamic workflows, verification, recovery, and learning-oriented procedures.

## Architectural position

The feature extends HARDNESS above its existing governed capability protocol. It does not replace `ctx.workflowEngine`, `ctx.subagents`, `ctx.skills`, `ctx.goals`, the plan subsystem, the guard subsystem, or the agent loop. HARDNESS remains the provider-neutral inventory and routing authority for declared capabilities. Cognitive workflow selection is a pure deterministic planning surface that tells the model and orchestration layer which procedural flows should be active for a mission.

The existing HARDNESS lifecycle remains authoritative for execution:

`inspect -> resolve -> plan -> approve -> execute -> verify -> present -> audit`

The new cognitive layer precedes and surrounds that lifecycle:

`frame -> recall -> select cognitive flows -> compose mission workflow -> execute through existing capabilities -> critic/judge -> verify -> learn/consolidate`

## Non-goals

- Do not patch `agent-loop`.
- Do not implement a second workflow runtime.
- Do not create a second subagent service.
- Do not grant permissions or execution authority from cognitive flow selection.
- Do not persist hidden reasoning traces or chain-of-thought.
- Do not claim autonomous learning has occurred merely because a flow was selected; learning flows produce explicit procedural outcomes for existing memory/skill systems to consume.

## Public model

### CognitiveFlowId

A stable string union naming first-party flows.

### CognitiveFlowDescriptor

Each flow declares:

- `id`: stable identifier.
- `name`: concise human-readable name.
- `purpose`: what the flow accomplishes.
- `useWhen`: mission conditions that justify the flow.
- `avoidWhen`: conditions where the flow is unnecessary or counterproductive.
- `requires`: prerequisite flow identifiers.
- `pairsWith`: useful companion flows.
- `outputs`: observable artifacts or decisions the flow should produce.
- `evidence`: evidence expected before the flow is considered satisfied.
- `cost`: `low | medium | high`.
- `criticality`: `optional | recommended | required-when-triggered`.

Descriptors are immutable data. They do not execute tools and do not authorize actions.

### CognitiveMissionProfile

A serializable, model-independent description of a mission:

- `kind`: `simple | build | debug | research | architecture | operational | recovery | mixed`.
- `complexity`: `low | medium | high`.
- `risk`: `low | medium | high`.
- `novelty`: `low | medium | high`.
- `requiresCodeChange`.
- `requiresExternalEvidence`.
- `hasIndependentSubtasks`.
- `persistent`.
- `previousFailure`.
- `repeatedPattern`.
- `userVisibleArtifact`.

The caller or model may construct this profile after intent framing. Selection is deterministic from the profile.

### CognitiveWorkflowPlan

Selection returns:

- the original mission profile;
- ordered selected flow IDs;
- a reason for every selected flow;
- skipped first-party flows with concise reasons;
- `qualityGates`, describing the minimum evidence expected before completion.

## First-party flow catalog

PHOENIX ships these first-party flows:

1. `intent-framing` — lock objective, deliverables, constraints, and success criteria.
2. `context-recovery` — recover relevant prior state, files, decisions, and mission checkpoints.
3. `experience-recall` — retrieve relevant prior successful or failed procedures.
4. `brainstorming` — generate alternatives before committing to a design.
5. `research-evidence` — gather and contrast external evidence.
6. `causal-reasoning` — trace cause/effect and dependencies.
7. `counterfactual-simulation` — compare likely consequences of alternative actions.
8. `architecture-design` — select interfaces, components, data flow, failure handling, and tests.
9. `implementation-planning` — turn an approved design into executable, dependency-aware tasks.
10. `proof-driven-development` — define failing evidence/tests before implementation and verify red/green behavior.
11. `systematic-debugging` — reproduce, isolate root cause, form/test one hypothesis, then fix.
12. `parallel-decomposition` — identify independent work that can run concurrently.
13. `fresh-agent-execution` — assign isolated task contexts to reduce context contamination.
14. `adversarial-critique` — actively search for omissions, unsafe assumptions, edge cases, and regressions.
15. `independent-judge` — compare requirements, evidence, implementation, and critique before PASS.
16. `verification-gate` — require fresh evidence before completion claims.
17. `recovery-checkpointing` — preserve resumable state for interruption, crash, quota, or restart.
18. `safe-change` — isolate risky configuration/code changes and preserve rollback.
19. `security-risk-review` — inspect permissions, secrets, reversibility, side effects, and blast radius.
20. `quality-escalation` — escalate strategy, reasoning effort, agent/model, or redesign after inadequate quality.
21. `outcome-evaluation` — compare delivered result with original objective and quality criteria.
22. `procedural-learning` — extract a reusable procedure from verified outcomes.
23. `experience-consolidation` — save verified lessons with provenance for later recall.
24. `failure-immunization` — convert repeated failures into guards, regression tests, or reusable diagnostics.
25. `metacognitive-review` — assess uncertainty, evidence gaps, contradictions, and strategy failure.
26. `autonomous-follow-up` — schedule or persist justified follow-up work when the mission creates future obligations.

## Selection rules

Selection is conservative for trivial work and progressively stronger for complex/risky work.

### Always

Every mission gets:

- `intent-framing`
- `verification-gate`
- `outcome-evaluation`

### Persistent missions

Add `context-recovery` and `recovery-checkpointing`.

### Build / architecture

Add `brainstorming`, `architecture-design`, and `implementation-planning`. Code changes add `proof-driven-development`. High complexity or novelty adds `counterfactual-simulation` and `adversarial-critique`.

### Debug / recovery

Add `systematic-debugging`, `causal-reasoning`, `safe-change`, and `failure-immunization` after repeated/previous failures. Code fixes add `proof-driven-development`.

### Research

Add `research-evidence`, `adversarial-critique`, and `metacognitive-review`. High-stakes research also adds `independent-judge` and `security-risk-review` when the output can drive consequential action.

### Independent subtasks

Add `parallel-decomposition` and `fresh-agent-execution` when work can be separated without shared mutable state.

### High risk

Add `security-risk-review`, `safe-change`, `adversarial-critique`, `independent-judge`, and `metacognitive-review`.

### Previous failure or inadequate quality

Add `quality-escalation`, `metacognitive-review`, and the domain-specific recovery flow.

### Repeated successful patterns

Add `experience-recall`; after successful verification, add `procedural-learning` and `experience-consolidation` when the procedure is reusable.

### Future obligations

`autonomous-follow-up` is selected only for persistent missions where a verified result creates a concrete future check or action. Selection never schedules anything by itself.

## Ordering

The selector returns a canonical order to avoid arbitrary model sequencing:

1. framing/context/experience
2. exploration/research/causal analysis
3. design/simulation
4. planning/decomposition
5. safe/proof-driven execution preparation
6. execution-quality loops
7. critic/judge/verification
8. outcome/learning/consolidation/follow-up

Prerequisites must appear earlier than dependents.

## Model-facing guidance

`renderCognitiveWorkflowGuide()` renders the flow catalog and the rules that govern it. `renderHardnessProtocol()` incorporates a concise requirement that the model classify the mission, select the cognitive workflow before execution planning, and adapt the workflow if evidence reveals a different mission type.

The prompt guidance must explicitly state:

- choose the lightest workflow that preserves quality;
- never skip root-cause analysis for debugging;
- never skip evidence verification before DONE;
- parallelize only independent work;
- use critic/judge separation for high-risk or high-complexity work;
- revise the workflow when new evidence invalidates the current strategy;
- do not expose private chain-of-thought; record decisions, evidence, artifacts, and externally useful rationale only.

## Quality gates

The planner returns quality-gate labels so downstream orchestration can require observable evidence. First version supports:

- `objective-locked`
- `root-cause-evidence`
- `design-approved`
- `failing-proof-observed`
- `fresh-verification`
- `independent-review`
- `risk-reviewed`
- `rollback-ready`
- `outcome-compared`

The first version is advisory/structural except where existing HARDNESS execution gates already enforce verification and audit. It must never weaken existing approval or execution authority.

## Adaptation

`adaptCognitiveWorkflow(plan, observation)` accepts an existing plan plus bounded observations such as:

- `execution-failed`
- `verification-failed`
- `new-risk`
- `scope-expanded`
- `independent-subtasks-discovered`
- `repeated-failure`

It produces a new immutable plan with additional required flows. Adaptation is monotonic within one mission: first-party safety/verification flows are not silently removed after activation.

## Testing

Unit tests prove:

- the catalog has unique IDs and valid prerequisites;
- trivial missions stay lightweight;
- build missions select brainstorming/design/planning/TDD;
- debug missions select root-cause-first debugging and safe change;
- high-risk missions select critic/judge/risk review;
- parallelizable missions select decomposition + fresh-agent execution;
- persistent/repeated missions select recovery and learning-oriented flows;
- adaptation adds recovery/escalation flows after failure;
- every plan includes verification and outcome evaluation;
- model-facing guidance names the cognitive router and completion evidence rule.

Existing HARDNESS tests must remain unchanged and passing.

## Documentation

Update the HARDNESS README and architecture documentation to describe cognitive workflows as provider-neutral procedural orchestration, not execution authority.
