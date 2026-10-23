# Agent Note: Verified reasoning activity with the user's output language

Status: implemented

English | [中文](2026-10-22-user-locale-reasoning-disclosure.zh.md)

## Problem

The reasoning disclosure displayed the same static notice on every step and did not distinguish current execution evidence from the provider's potentially private thinking text. The existing prompt selected the language of the latest user message even when a different language was explicitly saved in PHOENIX settings. Users may therefore see mismatched language output after switching models.

## Decision

The conversation's existing Tools group owns one collapsed Reasoning row for each reasoning step. The row opens only on explicit user input and shows an ordered view of genuine tool-call names and runtime state already present in that flow group. Running, failed and completed labels use the client locale dictionary. Neither raw provider reasoning nor tool arguments and outputs reach this disclosure. If no tool evidence is present, the view explicitly says so instead of inventing a plan, decision or summary. Technical tool names containing non-Latin scripts are masked in English and Spanish interfaces, without transforming the underlying event.

The Host locale plugin contributes a conditional prompt section from the persisted language preference when both settings and systemPrompt are available. The section requests responses and any public model-generated decision summaries in the selected language; absent an explicit preference, existing language selection remains unchanged. The text does not claim to translate output from an uncooperative provider. Filesystem paths, commands, citations and identifiers are never rewritten by this preference.

## Alternatives considered

**Reveal arbitrary provider reasoning text.** Rejected: many adapters expose private chain-of-thought without a public-summary provenance marker; revealing it would misclassify internal deliberation and may expose sensitive material.

**Generate a canned sequence of reasoning messages.** Rejected: fabricated stages cannot be independently verified and create misleading progress.

**Translate streaming raw reasoning in the browser.** Rejected: the renderer has no authorized translation pipeline, and asynchronous translation could expose intermediate content in the wrong language.

## Consequences

Users can inspect verifiable activity rather than repeatedly reading a fixed privacy notice. For models that do not emit a public reasoning summary, the disclosure identifies the actual tool evidence and does not pretend to show internal thoughts. A later provider-specific, explicitly public summary channel can enrich this view without changing the private-reasoning rule. The language preference remains best-effort for model prose; it does not guarantee translation of third-party tool output or detect all Latin-script language mismatches.

## Verification

Focused tests exercise opt-in disclosure, updates to actual tool status, absent evidence, language switching, foreign-script masking, exclusion of private text and the Host language instruction's persistence. Assembled Web and multi-provider smoke tests are required before release.
