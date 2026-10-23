# Agent Note: HumanOS grounded operational self-model

Status: implemented

English | [中文](2026-10-22-humanos-grounded-operational-self-model.zh.md)

## Problem

Phoenix already provides Kira's human-presence protocol, procedural session learning, cognitive attention, initiative, reality observations and a governed HARDNESS tool registry. Those services remain separate sources, so a model can mistake a capability descriptor for a currently usable tool or talk about unfinished tasks without distinguishing the active session from another agent's work. Another invented persona or second writable memory database would increase ambiguity.

## Decision

Full agent presets install one read-only `hardness:humanos-self-model` context on the existing model-visible, session-logged runtime-context seam. It computes aggregate HARDNESS descriptor states and visible global/current-agent durable task counts from already-loaded registries at assembly time. It reports only route-selection flags, status counts, due-task counts and an advisory attention label. It excludes task titles, account identities, model names, cross-agent tasks and unrevealed surprises. No provider calls, file reads, autonomous jobs, new ledgers or approval changes occur during the projection.

The generated prompt explicitly distinguishes verified **metadata** from actual tool reachability and instructs the active model to resolve/verify the exact capability through existing permission and mission systems. The existing Kira persona, Eclipse router and providers stay in charge of model choice. HumanOS does not suggest machine sentience, subjective emotions or unrestricted action authority.

A second bounded read of the already-resident HARDNESS case registry compares each checked descriptor's current version with its most recent evidence, counting passed/failed/denied and conflicting or stale proof. The projection checks no more than 64 descriptors and 12 rows for each; it reports the unexamined count and never claims this historical sample is fresh runtime availability. This adds no stored state, provider invocation, or automatic recovery authority.

## Alternatives considered

**Write a parallel HumanOS memory store.** Rejected: session learning, cognitive runtime and proactivity already own those facts; duplicated stores invite divergence and privacy leaks.

**Automatically wake or repair every degraded capability.** Rejected: global descriptor status does not establish relevance to the user's mission or authorization to mutate a dependency.

**Inject every tool and task name into the prompt.** Rejected: metadata may be stale, sensitive or adversarial; aggregate evidence is sufficient for a low-cost metacognitive cue.

## Consequences

Kira has a bounded, provider-neutral self-observation tied to actual registry state and current-agent visibility, without mistaking social fluency for consciousness. It still cannot assert a runtime tool works until it is resolved and tested. This is an initial HumanOS engineering slice, not a full biological human emulator or independent AGI. Unit and integration gates, Windows startup and real-provider behavior still require verification before stable promotion.
