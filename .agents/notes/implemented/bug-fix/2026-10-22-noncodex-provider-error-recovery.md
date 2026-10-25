# Agent Note: Recovering generic pi-ai errors without bypassing research validation

Status: implemented

English | [中文](2026-10-22-noncodex-provider-error-recovery.zh.md)

## Problem

A small OpenRouter model called `phoenix_research_publish` with title and sections only. The publication tool correctly refused to create an academic report without real `report.references`. A subsequent pi-ai model stream terminated with generic `PI_AI_ERROR`, which normal provider retry policy did not retry, ending the user turn.

## Decision

The publication tool now describes its bibliographic precondition in the schema field most models inspect, and the validator returns actionable research and citation-key guidance without inventing any source.

The pi-ai adapter distinguishes an otherwise unclassified generic error on eligible non-OpenAI/Codex routes/models with the specific transient `PI_AI_TRANSIENT_ERROR` code. On eligible routes with no explicit policy the normal recovery plugin gets at most two retries with existing logged backoff. OpenAI, Codex and ChatGPT Web routes are unchanged. OpenAI/Codex model IDs on OpenRouter are excluded. Explicit provider retry policies keep their semantics. Known invalid requests, quota and auth failures never become generic retries. A persistent error still fails visibly after the retry cap.

## Verification

Focus policy, streaming, and research publisher tests on: no references; source-linked contract; retry default; explicit opt-out; Code-x exclusion behind gateways; generic missing error; invalid arguments; auth refusal; and terminal event propagation. A real provider-keyed runtime test is still needed to establish the cause of the particular OpenRouter stream failure. Keep research source integrity enforced.

## Consequences

Research publication still requires real sources; nontransient failures remain visible.

## Alternatives considered

Retry all generic or invalid provider errors without classification. Rejected because authorization, quota and malformed requests are not transient.
