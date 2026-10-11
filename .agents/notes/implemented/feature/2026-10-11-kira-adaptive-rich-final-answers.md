# Agent Note: Adaptive rich final answers inside Phoenix chat

Status: implemented

English | [中文](2026-10-11-kira-adaptive-rich-final-answers.zh.md)

## Problem

Phoenix can already display assistant Markdown and bounded native visual artifacts, yet a completed task can end with a large unstructured paragraph, a raw JSON block, or a visually redundant status report. Without a shared presentation rule, the experience varies with the selected provider and repeated formatting instructions cost the user extra turns.

## Decision

The shared human-presence model section instructs Kira to present substantive final answers as readable inline chat content: concise result-first prose with proportionate Markdown headings, emphasized facts, small meaningful symbols and arrows, comparative tables, and structured charts or timelines only when grounded content justifies them. Provenance, verified outcomes, unresolved limitations and next steps remain distinguishable. The existing Markdown, canvas, and Phoenix visual renderers continue to own presentation; ordinary chat answers do not need HTML, a new wrapper, or a separate app surface. Social, sensitive, and trivial turns remain conversational and minimally decorated. Model-generated JSON, placeholder metrics, fabricated chart values, and unnecessary post-completion visual-tool calls are prohibited.

## Alternatives considered

**Automatically wrap every final message in colorful cards or charts.** Rejected because most exchanges need neither charts nor containers, and forced adornment hides important evidence.

**Replace native Markdown with model-supplied HTML or executable UI code.** Rejected because existing chat renderers already support the presentation primitives and untrusted executable output expands the security boundary.

**Force an extra model or tool call after task completion solely for formatting.** Rejected because that defeats Phoenix's universal stop rule and increases latency and token cost.

## Consequences

Kira's responses gain a stable, provider-independent presentation preference without a new dependency, schema, rendering pipeline, or user-visible configuration switch. Rendering still depends on truthful source data and tool availability. The instruction influences model behavior rather than guaranteeing an identical visual layout for every provider and context; deterministic transcript and visual tools continue to validate actual rendering.

## Verification

The human-presence contract test pins native formatting, evidence integrity, chart-selection constraints, protection against raw JSON, lightweight treatment of simple replies, and no extra model loop for decoration.
