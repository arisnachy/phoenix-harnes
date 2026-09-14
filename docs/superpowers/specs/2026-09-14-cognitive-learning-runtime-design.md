# Phoenix Cognitive Learning Runtime Design

## Goal

Make Phoenix improve after completed work instead of only remembering isolated tool successes. The runtime must learn from verified experience, accept explicit guided teaching, and raise the default quality bar without replacing HARDNESS, cognitive memory, Living Creations, or proactivity.

## Principles

- HARDNESS remains the executive completion authority.
- Learning is evidence-backed, provenance-aware, reversible, and secret-safe.
- A single successful tool call is not sufficient to establish a reusable procedure.
- Verified mission completion may promote a procedure learned from the sequence of actions and recovery lessons used in that mission.
- Explicit user teaching is retained as guided procedural knowledge and can later be superseded or quarantined by correction/evidence.
- Candidate or quarantined procedures must not enter ordinary model recall.
- Quality requirements are inferred from the requested capability/domain and added to the existing mission quality gate; existing generic guarantees remain.
- No existing Living, proactivity, memory, HARDNESS, MCP, UI, or update capability is removed.

## Learning model

A `ProceduralLearningEngine` persists versioned procedural memories with:

- origin: `guided` or `experience`
- status: `candidate`, `active`, or `quarantined`
- scope and trigger
- ordered steps
- evidence and provenance
- confidence, confirmations, failures, and corrections

Verified mission completion promotes an experience procedure. Guided teaching becomes active immediately because the user is the authority for their desired workflow, but subsequent explicit corrections quarantine/supersede it.

## Experience trace

The runtime tracks only bounded, secret-safe abstractions of execution:

- tool names used in order
- HARDNESS recovery lessons (`learning-recorded`)
- verified goal completion

Raw tool arguments and credentials are never persisted in automatic experience traces.

## Guided teaching

Expose a model-facing `memory_teach` tool for explicit user teaching. The system prompt instructs the model to use it when the user teaches a durable rule, demonstration, example, or preferred procedure. Inputs are bounded structured fields rather than raw hidden chain-of-thought.

## Quality intelligence

`quality-contract.ts` derives additional quality requirements from the capability request. Profiles cover software/code, UI/visual, research/document, data/analysis, automation/integration, and a strong general baseline. These requirements are appended to the existing HARDNESS requirements and judged by the independent mission judge.

## Branch reconciliation

`main` and `stable` must converge on one canonical code tree without dropping branch-exclusive capabilities. Reconciliation must use a union/merge result, preserve both histories as parents, run CI on the reconciled tree, then point both branches to the same verified commit. A destructive reset before union verification is prohibited.
