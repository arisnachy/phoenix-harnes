# Agent Note: Organization Forge

Status: implemented

English | [中文](2026-08-30-organization-forge.zh.md)

## Problem

Creating an organization or product requires more than a single model response: the work needs comparable research, safe reuse, coordinated engineering and security roles, evidence for each delivery requirement, and an explicit handoff decision. Without a durable record, a partial build could be presented as ready or private client data could be saved as reusable knowledge.

## Decision

The goal domain exposes `organizationForge`, an event-backed `OrganizationForgeLedger` that remains modular beside the core mission loop. A Forge build records its objective, required criteria, comparable research, a blueprint, concrete deliverables, Phoenix IT/Security/R&D work, alternative strategies, public sources, pre-reuse and post-modification audit results, current source revalidation, sanitized Atlas entries, independent judge verdict, and the selected handoff, assisted, or autonomous management mode.

The model-facing `organization_forge` tool owns the workflow: start, research comparable solutions, inspect, register a source, record audits, write a blueprint, register deliverables, record team work and alternative strategies, advance phases, attach evidence, revalidate sources, publish sanitized Atlas metadata, request an independent judge, and select management after readiness. Public source locators reject credential-bearing references, and Atlas publication rejects credential-like content. Research is required before design, a blueprint before building, and at least one verified deliverable before verification. Every reused source must pass license, dependency, secret, and vulnerability checks both before reuse and after modification, and a source must be revalidated before its pattern is published. A Forge build reaches `ready` only from `verifying` when every required criterion and deliverable is `verified`, every source passed both audits, and the independent judge returned `pass`. Failed work and judge changes remain active repair input; a repeated strategy failure requires a different named approach, and an external block remains explicit and durable.

The tool exposes a `nextAction` projection so the model can continue from the first missing requirement without inventing a mini-plan or treating a failed attempt as mission completion. The `block` action stores the exact external dependency, reason, last attempted time, and resume condition; `advance` can resume a blocked build after the condition is resolved. It presents the required post-build question and three choices: `Entregar`, `Gestión asistida`, and `Gestión autónoma`. Forge state is stored in the owning session log; it does not copy secrets, private client data, credentials, or unsafe metadata into Atlas or reusable records.

Execution-window limits remain attempt policy, not mission completion. The same-session goal driver rotates to a new goal revision after a window cap, resets that window's counter, records the continuation, and changes strategy. Provider and token failures are recoverable attempts; only explicit external blockers pause automatic work, and only an independent passing judge or explicit user cancellation may end the mission.

## Alternatives considered

**Making Forge the mission loop:** rejected because organization building is an optional user-facing capability and the core harness must continue to support ordinary coding, research, and automation missions.

**Storing reusable source code or research payloads in Atlas by default:** rejected because private client data and secrets must remain in the owning session or approved local storage; Forge records public provenance and bounded audit facts only.

**Allowing a ready phase after implementation or tests alone:** rejected because delivery requires research, a blueprint, concrete deliverables, criterion-level evidence, security revalidation after modification, and an independent judge.

## Consequences

Forge builds are inspectable and resumable, and management is an explicit post-delivery decision rather than an accidental autonomous takeover. The workflow adds durable events and judge calls, but the lifecycle is bounded by criteria, audit fields, recovery strategy records, and the existing mission continuation policy. Failed attempts remain history while active work identifies the current repair. Real external source audits, provider availability, and business-specific acceptance evidence still depend on the configured environment and must be recorded before readiness.

## Testing

The ledger tests cover durable research, source provenance, both audit stages, research-first lifecycle gates, blueprint and deliverable evidence, failed work, repeated-strategy rejection, source revalidation, sanitized Atlas publication, judge rejection and pass, management gating, and credential-bearing locator rejection. Goal-tool tests cover the model-facing workflow from research through judge and its next-action projection. Goal-round tests cover window rotation after the cap, retry after rate-limit, provider, token, and prompt-assembly failures, and preservation of an active mission. The goal and goal-tool aggregates typecheck and the focused suites pass.
