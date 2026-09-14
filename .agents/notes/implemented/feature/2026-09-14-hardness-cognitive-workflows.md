# Agent Note: Route missions through explicit cognitive workflows

Status: implemented

English | [中文](2026-09-14-hardness-cognitive-workflows.zh.md)

## Problem

PHOENIX already has strong execution primitives: HARDNESS capability routing and evidence, durable mission state, an independent mission judge, workflow execution, subagents, skills, planning, goals, guards, and durable sessions. The missing layer is procedural selection. A model can know how to brainstorm, debug systematically, use tests, research evidence, delegate, review, or recover, but the harness did not expose one canonical inventory that says which of those processes exist, when they apply, how they compose, and when new evidence should strengthen the process. Leaving that entirely to one model makes quality depend on model memory and creates inconsistent behavior between providers.

The requirement is not a second agent loop or a second workflow runtime. The harness should make the system stronger than any single model by combining persistent process knowledge with the existing execution authorities, while retaining approval, verification, judge, audit, and recovery gates.

## Decision

`@phoenix-ai/dsh-hardness` owns a deterministic first-party cognitive workflow catalog and pure router. A `CognitiveMissionProfile` contains only bounded mission facts: kind, complexity, risk, novelty, code/evidence requirements, independent subtasks, persistence, prior failure, repeated pattern, and whether the result is user-visible. `selectCognitiveWorkflow()` maps that profile to an immutable ordered `CognitiveWorkflowPlan`; `adaptCognitiveWorkflow()` strengthens the profile and reselects when bounded observations such as execution failure, verification failure, new risk, expanded scope, newly discovered independent subtasks, or repeated failure appear.

The catalog contains 26 flows: intent framing, context recovery, experience recall, recovery checkpointing, brainstorming, research/evidence, causal reasoning, systematic debugging, counterfactual simulation, architecture/design, implementation planning, parallel decomposition, fresh-agent execution, safe change, security/risk review, proof-driven development, metacognitive review, quality escalation, adversarial critique, independent judge, verification gate, outcome evaluation, failure immunization, procedural learning, experience consolidation, and autonomous follow-up.

Selection uses a canonical order and prerequisite closure, so dependent procedures cannot precede their prerequisites. Every mission includes intent framing, fresh verification, and outcome evaluation. Debugging is root-cause-first; code changes request proof-driven development; high-risk and high-complexity work adds adversarial and independent review; only explicitly independent work activates parallel decomposition and fresh-agent execution; persistent and repeated work activates recovery and learning-oriented procedures. Quality-gate labels describe observable evidence downstream orchestration should obtain, but they do not grant authority.

`renderCognitiveWorkflowGuide()` exposes the catalog and composition rules to models. The existing HARDNESS prompt adapter installs that guide next to `renderHardnessProtocol()`, so every model mounted through the normal HARDNESS composition knows the processes without having to remember to load a skill. The guide forbids exposing private chain-of-thought and asks for decisions, evidence, artifacts, and audit-useful rationale instead.

## Authority boundaries

Cognitive routing is procedural planning only. It does not execute tools, approve permissions, create tasks, select credentials, or replace `ctx.workflowEngine`, `ctx.subagents`, `ctx.skills`, goals, plan state, session persistence, or the HARDNESS mission kernel. The existing HARDNESS lifecycle remains authoritative: `inspect → resolve → plan → approve → execute → verify → present → audit`. A selected flow cannot bypass approval, the independent judge, quality gates, capability evidence, quarantine, or WALL_PROTOCOL recovery.

Learning-oriented flows also do not claim that a model has silently changed its weights or that speculative text became memory. They identify when verified outcomes are eligible for reusable procedure extraction or consolidation; existing mission/session/skill systems remain the persistence authority. `autonomous-follow-up` similarly identifies a future obligation but requires an existing scheduler/proactivity authority to create or execute it.

## Alternatives considered

**Skills only** — rejected as the primary mechanism. Skills remain useful procedural content, but relying on the model to remember discovery/loading recreates the original inconsistency.

**Rigid user-visible modes** — rejected. Real missions mix design, research, debugging, execution, review, and recovery; a single mode creates unnecessary branching and poor adaptation when evidence changes.

**A second workflow or agent runtime** — rejected. PHOENIX already has provider-neutral workflow and subagent seams. Duplicating them would create competing execution authorities and make recovery harder.

**Patch the agent loop** — rejected. The catalog is pure planning data and model guidance and fits existing extension points. The agent loop remains replaceable.

## Consequences

Models get a stable vocabulary for high-quality work and can construct lighter or stronger procedures according to mission facts instead of improvising the process each turn. Providers can change without changing the catalog. Failures can strengthen the workflow rather than prematurely closing a mission. Because the selection surface is deterministic and JSON-serializable, it is testable without model calls and auditable without storing private reasoning.

The first version intentionally does not infer `CognitiveMissionProfile` from hidden reasoning and does not execute the returned plan. Higher-level mission orchestration may supply the profile, inspect the selected flows, and use the already-existing workflow/subagent/skill services to realize them.

## Verification

Unit coverage checks catalog uniqueness and prerequisites, lightweight trivial selection, build/design/TDD selection, root-cause-first debugging, high-risk research, parallelization constraints, persistent/repeated recovery and learning, monotonic adaptation after failures or risk changes, quality-gate labels, English/Spanish model guidance, and integration of the cognitive guide into the HARDNESS system-prompt section. Existing HARDNESS operating, mission, approval, judge, and evidence tests remain the regression authority for execution safety.
