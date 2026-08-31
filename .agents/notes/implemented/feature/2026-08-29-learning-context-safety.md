# Agent Note: Learning context safety

Status: implemented

English | [中文](2026-08-29-learning-context-safety.zh.md)

## Problem

Automatically retained learning can contain literal source code or user data that looks like a Phoenix prompt variable, such as `{{A=3;while(A!=3){...}}}`. The strict prompt renderer must not reject that evidence or reinterpret it as a template.

## Decision

`PromptContext` supports `interpolateVariables: false` for resolved context that must remain literal. The learning context consumer uses this mode because its records are serialized evidence, not Phoenix-authored prompt templates. Ordinary prompt contexts retain strict variable interpolation by default, so malformed deployment-authored templates still fail loudly.

## Alternatives considered

**Escape braces in serialized memory.** This would alter code and user text before it reaches the model and could create a second escaping format.

**Relax the global prompt parser.** This would hide malformed deployment templates and weaken the existing fail-loud contract.

## Consequences

Learned code-like text survives prompt rendering byte-for-byte while ordinary contexts keep their existing validation. The behavior is covered by an assembled-plugin regression test; memory remains bounded, provenance-preserving, and untrusted.
