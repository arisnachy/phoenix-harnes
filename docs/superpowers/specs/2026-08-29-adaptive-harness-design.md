# Adaptive Harness, Universal Sandbox, and Specialist Labs

English | [中文](2026-08-29-adaptive-harness-design.zh.md)

## Purpose

PHOENIX must keep an approved mission moving without repeated plan prompts, present every generated artifact in one adaptive surface, and turn a user-requested domain into a persistent, evidence-backed specialist laboratory.

## Product requirements

### One mission plan and bounded approvals

The goal driver creates one complete plan for the mission. Only that initial plan requires explicit user approval. Later approval requests carry a policy-derived recommendation, a visible second-by-second deadline, and an automatic decision at expiry. The decision is persisted before work resumes.

Automatic decisions are risk-aware. Low-risk read-only and reversible actions may default to the recommendation that allows progress. Destructive, credential-bearing, network-sensitive, or irreversible actions default to rejection and trigger the existing alternative-strategy path. No approval request may leave the driver waiting without a deadline.

### Adaptive artifact surface

All model-generated artifacts use one persisted envelope with a typed media kind, execution capability, source data, optional result, and sizing hints. The client chooses the renderer from the envelope rather than from a separate panel per language. Static text, JSON, tables, Markdown, images, and source code render inline. Runnable HTML/JavaScript runs inside a sandboxed iframe. Python and process artifacts run through the configured sandbox provider and stream output, errors, and generated files.

The surface measures its content and adjusts height up to a configurable maximum. Larger content scrolls inside the surface. Every run has stop, restart, copy, download, and expand controls. Source and result events are durable so a session replay shows the same artifact without re-executing it.

### Persistent specialist laboratory

The specialist domain stores a requested subject, objective, success criteria, source records, datasets, hypotheses, experiments, metrics, findings, synthesized skills, refresh policy, and judge verdicts. It progresses through `scoping`, `researching`, `hypothesizing`, `experimenting`, `evaluating`, `ready`, and `blocked` states. Each transition is an append-only session event and is folded into a durable view.

The laboratory uses existing web, filesystem, sandbox, skill, and judge capabilities. It records source URI, retrieval time, content hash, and provenance. Experiments are reproducible from their input artifact and declared command. A specialist becomes `ready` only after an independent judge validates the evidence against the success criteria. Failed evaluations produce bounded improvement tasks and resume from the last checkpoint. Refresh is opt-in and rate-limited; the system never runs an unbounded background learning loop.

Sensitive domains remain analytical by default. A sports-betting specialist may evaluate historical data and uncertainty, but it does not place wagers, claim guaranteed profit, or hide the limits of its evidence.

## Architecture

Approval deadlines extend the existing approval seam and session events. The client renders a single `ApprovalCountdown` for pending approvals and resolves expiry through the same API as a click, so replay and live operation share one path.

Artifacts extend the existing HARDNESS artifact envelope and `HardnessArtifactNodeView`. A `UniversalArtifactSurface` selects pure renderers and delegates execution to a sandbox RPC. Resize messages are accepted only from the owned iframe token; the host applies min/max bounds before changing layout.

The specialist laboratory is a new capability seam with service definition, durable fold, tool consumer, and client projection. It composes with the existing goal supervisor instead of modifying the agent loop. The goal supervisor schedules one bounded lab step at a time and records judge feedback, strategy changes, and terminal state.

## Failure handling

Expired approvals use the stored recommendation only after validating its policy version and risk class. If the recommendation is stale or invalid, the request rejects and the supervisor selects another strategy. Sandbox executions have a process timeout, output cap, and cancellation path; a failed run becomes an artifact result and does not corrupt the mission log. Laboratory source failures are recorded with a bounded error and cause source substitution or an explicit `blocked` verdict after the configured attempt limit.

## Verification

Focused unit tests cover deadline folding, risk defaults, artifact normalization, renderer selection, iframe resize validation, sandbox cancellation, lab event replay, experiment reproducibility, and judge transitions. Web tests cover desktop and narrow layouts, long content, executable HTML, and a completed specialist run. Built tests verify that the assembled application loads the new slots and RPC declarations.
