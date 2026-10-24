# Agent Note: Learn from incomplete missions without pretending they succeeded

Status: implemented

English | [中文](2026-10-16-capture-blocked-task-procedures.zh.md)

## Problem

Phoenix already persisted verified procedures on `goal/change: complete`, but discarded the workflow trace when a goal blocked. For complex browser workflows this lost the only evidence of partial navigation and tool choices, forcing repeated cold starts.

## Decision

The procedural learning listener now records a bounded, argument-free *candidate* at `goal/change: block` with the actual task trigger, provenance and an explicit incomplete-outcome warning. The working trace remains available for a later genuine verified completion. A blocked procedure is not promoted to an active automatically reusable recipe, does not infer private subjective survey answers, and carries no URL tokens, personal fields or secrets from raw tool arguments. A later verified completion remains the promotion authority.

Users can explicitly teach a safe repeatable routine using existing `memory_teach`; for the actual survey, filling the same fields in future must rely on their authored responses, their general authorization and fresh verified site state, not synthetic testimony.

## Consequences

A blocked trace remains an explicitly incomplete candidate until genuinely verified completion.

## Alternatives considered

Discard blocked workflow traces, or promote incomplete traces as successful recipes. Both were rejected because they lose provenance or falsely claim completion.
