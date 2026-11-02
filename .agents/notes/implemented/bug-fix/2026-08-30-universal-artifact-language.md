# Agent Note: explicit universal artifact languages

Status: implemented

English | [中文](2026-08-30-universal-artifact-language.zh.md)

## Problem

The universal artifact normalizer used a conditional expression with the wrong precedence, so an explicit language such as `javascript` could be treated as an inferred MIME match and classified as Python. Sandbox execution results also lived only in the React component and disappeared after a reload.

## Decision

Honor explicit language metadata first, then infer a language from the MIME type only when metadata is absent. Keep the inference bounded to the supported Python, JavaScript, TypeScript, and CSS renderers. Append each structured execution result as the `hardness/artifact` session event, keyed by artifact and originating tool call, so the conversation node replays the latest result after reopening.

## Consequences

Code artifacts keep the language selected by the producer, while MIME-only artifacts retain deterministic syntax classification. Successful and failed runtime results are durable and replayable; raw source and credentials are not added to the execution event because the original artifact event already carries the source.

## Alternatives considered

Keeping execution results only in the React component would lose them on reload, so the session event was chosen as the durable source. Inferring every language from MIME would override explicit producer metadata, so inference remains the fallback only.

## Testing

`packages/client/ui-conversation/tests/universal-artifact-surface.client.spec.tsx` covers explicit JavaScript metadata, `hardness-artifact-node.client.spec.ts` covers replay, and the focused artifact/runtime suite passes 11 tests. TypeScript checks pass for the adapter and UI-conversation packages.
