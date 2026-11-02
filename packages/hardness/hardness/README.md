# `@phoenix-ai/dsh-hardness`

English | [中文](README.zh.md)

Provider-neutral capability registry, Tool Atlas, and cognitive workflow planner for PHOENIX HARDNESS.

The service records declared capability descriptors, required permissions, lifecycle status, verification evidence, and declarative modality routes. It does not grant permissions, store credentials, execute tools, or replace the tool, skill, workflow, subagent, goal, or plan registries.

A route is selected only when the resolver returns a currently usable capability and its declared modalities intersect the requested preference. `unknown` means the need cannot be classified; `missing` means the need is known but no verified capability and modality can satisfy it. Required permissions are copied as declarations for a later broker, never granted here.

`CapabilitySurface` projects a route into stable preview data (`id`, inputs, outputs, modality, verification, and declared permissions). It is JSON-serializable and contains no callback, credential, sandbox handle, or workspace mutation. Missing and unknown resolutions produce no surface.

## Cognitive workflow engine

HARDNESS also ships a deterministic first-party cognitive workflow catalog. A `CognitiveMissionProfile` describes mission kind, complexity, risk, novelty, persistence, code/evidence needs, independent subtasks, repeated patterns, prior failure, user-visible output, and whether a concrete future obligation exists. `selectCognitiveWorkflow()` maps that profile to the lightest ordered `CognitiveWorkflowPlan` that preserves quality; `adaptCognitiveWorkflow()` monotonically strengthens the plan when execution fails, verification fails, risk appears, scope expands, independent subtasks are discovered, failure repeats, or a future obligation is discovered.

The catalog includes intent framing, context recovery, experience recall, brainstorming, research/evidence, causal reasoning, systematic debugging, counterfactual simulation, architecture/design, implementation planning, proof-driven development, parallel decomposition, fresh-agent execution, adversarial critique, independent judgment, verification, recovery checkpointing, safe change, security/risk review, quality escalation, outcome evaluation, procedural learning, experience consolidation, failure immunization, metacognitive review, and autonomous follow-up.

Cognitive selection is procedural guidance, not execution authority. It does not run a capability, grant a permission, schedule a task, or persist private reasoning. Existing `ctx.workflowEngine`, `ctx.subagents`, `ctx.skills`, goals, sessions, approval brokers, and HARDNESS execution gates remain authoritative. The model-facing guide explicitly forbids exposing private chain-of-thought and asks models to record only decisions, evidence, artifacts, and audit-useful rationale.

Quality gates returned with a plan are observable labels such as `objective-locked`, `root-cause-evidence`, `design-approved`, `failing-proof-observed`, `independent-review`, `risk-reviewed`, `rollback-ready`, `fresh-verification`, and `outcome-compared`. Existing HARDNESS approval, verification, presentation, judge, and audit rules remain unchanged and stronger than these advisory planning labels.

### Structured model-facing router

Model presets mount a pure read-only `hardness_workflow` tool next to `hardness_run`. The model supplies a validated `CognitiveMissionProfile`; the tool returns the execution mode, numeric complexity/risk/novelty/evidence measurements, routing thresholds, explicit execution budget, ordered selected flows, activation reasons, skipped flows, and quality gates. An optional bounded observation strengthens the profile and recomputes the workflow. The tool never calls another tool, never grants permissions, and is excluded from the host Tool Atlas so HARDNESS does not recursively advertise its own router as an executable capability.

For a non-trivial mission the operating protocol tells the model to call `hardness_workflow` before formulating the execution plan, and to call it again when risk, scope, task independence, failure evidence, or a concrete future obligation changes. `future-obligation-discovered` makes the mission persistent and activates `autonomous-follow-up`; the authorized scheduler/proactivity runtime remains solely responsible for actually creating or executing future work.

### Execution modes and process authority

Every workflow plan includes `executionMode: 'fast' | 'standard' | 'deep'`, numeric measurements, routing thresholds, and a bounded budget. The fast budget permits 1 attempt, 1 recovery attempt, no external sources, no parallel subtasks, and no review passes; standard permits 2, 2, 3, 4, and 1 respectively; deep permits 3, 3, 8, 8, and 2. A bounded low-risk, low-novelty localized change uses `fast`, which deliberately skips brainstorming, architecture design, implementation-plan ceremony, and non-triggered adversarial review. Fast code changes still select `safe-change` and retain objective locking, rollback readiness, fresh targeted verification, and outcome comparison. Standard and deep modes activate stronger planning, proof, research, review, and judge flows only when the mission profile or fresh evidence justifies them.

Selected HARDNESS flows are the process policy for the mission. A generic methodology-skill catalog must not create a second approval loop merely because brainstorming or planning appears broadly applicable; process skills are loaded only when they implement flows selected by HARDNESS. Bounded observations can only strengthen the workflow: failures, new risk, expanded scope, external-evidence needs, persistence, and independent subtasks cause deterministic escalation instead of premature mission termination.

## Model Experience

### Capability Atlas metadata

#### What the model sees

Consumers may expose declarative HARDNESS fields such as `capabilityId`, modality, verification state, inputs, outputs, and declared permissions; the registry itself exposes no credential or executable handle. The HARDNESS adapter injects the cognitive workflow catalog and mounts `hardness_workflow`, so every mounted model knows which procedural flows exist and has a deterministic harness-owned way to select, compose, and strengthen them.

##### Cognitive routing and operating protocol

```markdown
Classify the mission, call hardness_workflow for non-trivial work, and use the returned execution mode, ordered pipeline, and quality gates before execution planning. Use fast mode for bounded cosmetic, wording, styling, and localized implementation changes; make the smallest safe change and verify it with fresh targeted evidence. Debugging is root-cause-first; only independent work may be parallelized; high-complexity/high-risk work separates implementation, adversarial critique, and independent judgment. New evidence may strengthen the workflow. Selected HARDNESS flows own process policy, so routine process-skill ceremony must not create another approval loop. The shared execution lifecycle remains inspect → resolve → plan → approve → execute → verify → present → audit, and no flow selection grants execution authority.
```

#### Token effect

Consumers that install the HARDNESS protocol add one stable cognitive catalog plus lifecycle guide to the system prompt. The catalog is deterministic and cache-friendly; selected mission plans are computed structurally by `hardness_workflow` rather than by embedding private reasoning traces.

#### KV Cache effect

Stable descriptors and cognitive guidance remain cache-friendly until capability metadata, routing, verification state, or the shipped flow catalog changes.

## Known Limitations and Deferred Work

- Cognitive selection is deterministic from the supplied mission profile; the first version does not infer that profile from hidden model reasoning.
- Learning-oriented flows describe when verified lessons should be extracted or consolidated; storage remains owned by existing mission/session/skill systems rather than a second HARDNESS memory database.
- `autonomous-follow-up` identifies a justified future obligation and can now be selected structurally, but it does not schedule work by itself; an existing scheduler/proactivity capability remains the execution authority.
- The capability resolver and in-memory provider remain the foundation layer. Durable storage, source adapters, external acquisition, visual renderers, and generative UI are separate consumers and providers above this seam.
