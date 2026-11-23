# Agent Note: Contextual Healthia clinical editor

Status: implemented

English | [中文](2026-11-23-healthia-contextual-clinical-editor.zh.md)

## Problem

The native editor grouped vital measurements and examination in one panel, required re-entering longitudinal history, and could not call the existing protected model adapters on its live narrative fields. General workspace inspection did not expose clinical navigation targets.

## Decision

Separate six editor steps without changing the persisted note grammar. Recover only documented longitudinal history into empty fields on explicit request; never reuse old vital measurements. Extract only labeled measurements and require clinician acceptance before filling fields. BMI and estimated mean arterial pressure are arithmetic, not clinical decisions.

The field-specific Host endpoint authorizes the owning clinician, exact encounter revision, draft status and non-confidential record before and after model inference. It processes only the explicitly selected text with the existing model registry and consent mechanism. Model output is a proposal, not a record mutation. The editor rejects results if the source text, version or mounted encounter changes. Review, signing and printing are disabled for uncommitted edits.

The existing adaptive open operation navigates clinical steps; structural inspection exposes navigation metadata only. Clinical identities, notes, values and credentials do not enter the general chat event bus.

## Alternatives considered

- Generic field AI bridge: rejected because clinical values do not belong in general chat or its session history.
- Automatically accepting model output or reusing old vitals: rejected because provenance and verification are required.
- New EHR database: rejected because the current encrypted Host owns records and authorization.

## Consequences

The native editor supports explicit clinical narrative refinement and structured manual capture. Full chart reasoning, automatic diagnostic coding, universal clinical chat mutation, and self-rewriting medical rules are not delivered by this change. Clinical safety and real model execution need clinical and provider validation.

## Testing

Focused editor tests cover longitudinal recovery, vital confirmation, explicit model consent and stale proposals. Store tests cover ownership, revision and draft-state checks. CI must validate compilation and regressions on the exact head.
