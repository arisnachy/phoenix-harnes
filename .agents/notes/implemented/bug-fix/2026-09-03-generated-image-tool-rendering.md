# Agent Note: Render generated Tool images instead of attachment JSON

Status: implemented

English | [中文](2026-09-03-generated-image-tool-rendering.zh.md)

## Problem

The image-generation runtime already persisted a valid generated image and returned a Tool result containing a text block plus a durable `image` block. The Web generic Tool presenter flattened every non-text result block with `JSON.stringify`, so users saw attachment metadata such as `attachmentId`, `mediaType`, dimensions, and byte count instead of the generated PNG.

This was a presentation defect, not an image-generation failure: the attachment package already had the authorized durable-image loader and gallery renderer used by ordinary assistant message images.

## Decision

- `resultText` no longer serializes `image` blocks into generic Tool output text. Text blocks remain verbatim and unknown non-image shapes retain the JSON diagnostic fallback.
- `ToolCallTree` threads its existing `renderMessageImages` callback into the generic Tool fallback without changing the public atomic `ToolCallOwnerProps` slot contract.
- `GenericToolCard` extracts settled durable image blocks and projects their attachment references through `renderMessageImages({ align: 'start' })`.
- `ui-attachment` remains the sole owner of image authorization, loading, gallery presentation, and URL lifecycle.

## Verification

`packages/client/ui-tool/tests/tool-call-tree.client.spec.tsx` contains a regression case matching the generated-image result shape and requires the durable attachment to pass through the conversation image renderer. CI/typecheck/lint remain the merge gate for the complete change.

## Consequences

Generated images returned by generic Tool calls render inline in the transcript while their raw attachment metadata is no longer exposed as user-facing result text. Existing specialized Tool views keep their keyed replacement behavior, and no model/runtime image-generation protocol changes are required.
