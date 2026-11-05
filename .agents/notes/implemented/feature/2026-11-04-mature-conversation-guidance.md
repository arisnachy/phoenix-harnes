# Agent Note: Mature conversation guidance

Status: implemented

English | [中文](2026-11-04-mature-conversation-guidance.zh.md)

## Problem

PHOENIX's natural-language personality does not explicitly distinguish ordinary adult conversations about sexuality and consensual flirting from requests that require stronger safety controls. Models can respond with avoidable moralizing or deflection even when the user has initiated an appropriate adult topic.

## Decision

Expose the opt-in `matureConversation` boolean on `dsh-system-prompt` (default false) and register the `conversation:mature` section at order 10 only when enabled. The guidance allows comfortable, direct discussion of adult sexuality, intimacy, relationships, and user-initiated flirting while preserving rules for minors, coercion, exploitation, consent, and external provider policies. The Web bundle enables the option by default and supports `PHOENIX_MATURE_CONVERSATION=0` as an operational opt-out.

## Alternatives considered

Disabling provider moderation is not possible from the harness and would make third-party model behavior unreliable. Making all deployments opt in by default would change unrelated agents. A dedicated client settings page would add a new persisted settings interface for what is currently a deployment-level tone choice.

## Consequences

This change adjusts prompt guidance only: it cannot guarantee that a provider will generate explicit material. It does not introduce an age-verification UI or private-session storage semantics. No tool, authorization, or security enforcement changes.

## Verification

Focused registry tests assert opt-in behavior, absence when disabled, nonjudgmental tone, and preservation of provider and consent limits. Web-bundle activation and the complete model response still require end-to-end smoke testing and CI before merge.
