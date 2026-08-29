# Agent Note: readable Windows sandbox paths

Status: implemented

English | [中文](2026-08-28-sandbox-path-presentation.zh.md)

## Problem

Windows filesystem separators were rendered as escaped JSON text in the sandbox guidance, making the path shown to the model harder to read without changing the policy it represented.

## Decision

The sandbox policy prompt renders workspace and PHOENIX evolution roots as quoted filesystem paths without JSON-escaping Windows separators. Embedded quotes remain escaped so the prose stays unambiguous.

## Verification

The Windows HARDNESS sandbox-policy tests pass, including the model-facing self-evolution guidance. This changes prompt presentation only; sandbox mode resolution, protected roots, and write enforcement remain unchanged.

## Consequences

Model-facing sandbox guidance shows readable quoted Windows paths while embedded quotes stay escaped. Enforcement, protected roots, and mode resolution remain unchanged.

## Alternatives considered

Changing path resolution or normalizing Windows separators would alter filesystem semantics for a presentation-only defect and could weaken the policy's relationship to the actual path.
