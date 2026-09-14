# `@phoenix-ai/dsh-hardness`

English | [中文](README.zh.md)

Provider-neutral capability registry, Tool Atlas, and cognitive workflow planner for PHOENIX HARDNESS.

The service records declared capability descriptors, required permissions, lifecycle status, verification evidence, and declarative modality routes. It does not grant permissions, store credentials, execute tools, or replace the tool, skill, workflow, subagent, goal, or plan registries.

A route is selected only when the resolver returns a currently usable capability and its declared modalities intersect the requested preference. `unknown` means the need cannot be classified; `missing` means the need is known but no verified capability and modality can satisfy it. Required permissions are copied as declarations for a later broker, never granted here.

`CapabilitySurface` projects a route into stable preview data (`id`, inputs, outputs, modality, verification, and declared permissions). It is JSON-serializable and contains no callback, credential, sandbox handle, or workspace mutation. Missing and unknown resolutions produce no surface.

## Cognitive workflow engine

HARDNESS also ships a deterministic first-party cognitive workflow catalog. A `CognitiveMissionProfile` describes mission kind, complexity, risk, novelty, persistence, code/evidence needs, independent subtasks, repeated patterns, prior failure, and user-visible output. `selectCognitiveWorkflow()` maps that profile to the lightest ordered `CognitiveWorkflowPlan` that preserves quality; `adaptCognitiveWorkflow()` monotonically strengthens the plan when execution fails, verification fails, risk appears, scope expands, independent subtasks are discovered, or failure repeats.

The catalog includes intent framing, context recovery, experience recall, brainstorming, research/evidence, causal reasoning, systematic debugging, counterfactual simulation, architecture/design, implementation planning, proof-driven development, parallel decomposition, fresh-agent execution, adversarial critique, independent judgment, verification, recovery checkpointing, safe change, security/risk review, quality escalation, outcome evaluation, procedural learning, experience consolidation, failure immunization, metacognitive review, and autonomous follow-up.

Cognitive selection is procedural guidance, not execution authority. It does not run a tool, grant a permission, schedule a task, or persist private reasoning. Existing `ctx.workflowEngine`, `ctx.subagents`, `ctx.skills`, goals, sessions, approval brokers, and HARDNESS execution gates remain authoritative. The model-facing guide explicitly forbids exposing private chain-of-thought and asks models to record only decisions, evidence, artifacts, and audit-useful rationale.

Quality gates returned with a plan are observable labels such as `objective-locked`, `root-cause-evidence`, `design-approved`, `failing-proof-observed`, `independent-review`, `risk-reviewed`, `rollback-ready`, `fresh-verification`, and `outcome-compared`. Existing HARDNESS approval, verification, presentation, judge, and audit rules remain unchanged and stronger than these advisory planning labels.

## Model Experience

### Capability Atlas metadata

#### What the model sees

Consumers may expose declarative HARDNESS fields such as `capabilityId`, modality, verification state, inputs, outputs, and declared permissions; the registry itself exposes no credential or executable handle. The HARDNESS adapter also injects the cognitive workflow catalog so every mounted model knows which procedural flows exist and the rules for selecting, composing, and strengthening them.

##### Cognitive routing and operating protocol

```markdown
Classify the mission and choose the lightest cognitive workflow that preserves quality. Debugging is root-cause-first; only independent work may be parallelized; high-complexity/high-risk work separates implementation, adversarial critique, and independent judgment. New evidence may strengthen the workflow. The shared execution lifecycle remains inspect → resolve → plan → approve → execute → verify → present → audit, and no flow selection grants execution authority.
```

#### Token effect

Consumers that install the HARDNESS protocol add one stable cognitive catalog plus lifecycle guide to the system prompt. The catalog is deterministic and cache-friendly; the selected mission plan is computed structurally rather than by embedding private reasoning traces.

#### KV Cache effect

Stable descriptors and cognitive guidance remain cache-friendly until capability metadata, routing, verification state, or the shipped flow catalog changes.

## Known Limitations and Deferred Work

- Cognitive selection is deterministic from the supplied mission profile; the first version does not infer that profile from hidden model reasoning.
- Learning-oriented flows describe when verified lessons should be extracted or consolidated; storage remains owned by existing mission/session/skill systems rather than a second HARDNESS memory database.
- `autonomous-follow-up` describes a justified future obligation but does not schedule work by itself; an existing scheduler/proactivity capability remains the execution authority.
- The capability resolver and in-memory provider remain the foundation layer. Durable storage, source adapters, external acquisition, visual renderers, and generative UI are separate consumers and providers above this seam.
