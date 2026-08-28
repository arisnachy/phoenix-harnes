# Agent Note: HARDNESS model operating protocol

Status: implemented

English | [中文](2026-08-28-hardness-model-operating-protocol.zh.md)

## Decision

PHOENIX exposes one deterministic model-facing lifecycle for governed HARDNESS operations: `inspect`, `resolve`, `plan`, `approve`, `execute`, `verify`, `present`, and `audit`. `@deepseek-ai/dsh-hardness` owns the serializable protocol types, evaluator, and guide renderer. `@deepseek-ai/dsh-hardness-adapters` installs the guide into the canonical system-prompt service as `hardness:operating-protocol`.

The evaluator accepts only observed route, approval, execution, verification, presentation, and evidence states. It returns the next step, an explicit outcome, allowed actions, forbidden actions, and a reason. It never executes a tool, grants a permission, opens a connector, or carries a credential.

## Safety rules

Unknown and missing routes stop at resolution. A pending approval stops at approval when the route declares permissions. A `not-required` approval state conflicts with any non-empty declared permission list. Failed execution or verification cannot advance to presentation, audit, or a success claim. A route with no declared permissions may record that no approval is required before dispatch.

## Verification

The HARDNESS protocol tests cover unknown and missing routes, approval ordering, permission-policy conflicts, execution-to-audit progression, failed verification, stable rendering, absence of executable values, and reversible prompt-section registration. The HARDNESS and adapter package typechecks pass on the Windows checkout.

## Consequences

Models receive a shared lifecycle vocabulary even when the selected provider changes. The protocol is guidance and evaluation, not an execution authority; the canonical tool runtime, permission broker, sandbox policy, artifact runtime, and session persistence remain their existing authorities.

The adapter also follows `tools/change`, so a connector that publishes or retracts tools updates the HARDNESS projection without duplicating registrations. The internal `hardness_run` tool is excluded from that projection.
