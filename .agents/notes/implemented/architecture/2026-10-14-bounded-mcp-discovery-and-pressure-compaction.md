# Agent Note: Bounded MCP discovery and useful pressure compaction

Status: implemented

English | [中文](2026-10-14-bounded-mcp-discovery-and-pressure-compaction.zh.md)

## Problem

A full connected MCP catalog repeats large schemas in every native request and each specialist. Fixed prompt overhead can exceed an early compaction threshold even when the removable conversation head contains only a few tokens. Summarizing that head consumes an additional model request without reducing pressure, and retrying the same non-shrinking region repeats that cost.

## Decision

The tool registry presents large MCP catalogs through scoped `tool_search` discovery in native mode. Native tools remain visible. Discovery searches only the caller's permitted live definitions, returns bounded metadata, and makes selected complete schemas available to subsequent requests. Large individual schemas remain discoverable. The active discovery window is bounded, independent for each agent, and cleared when the agent becomes idle. Registration, permission checks, argument validation, approval, and actual MCP execution retain their existing authority. Code and combined presentation modes preserve their existing SDK and function surfaces.

Automatic pressure compaction prices the minimum durable checkpoint before requesting a summary. Regions too small to shrink are skipped. A deterministic non-shrinking failure suppresses another pressure attempt against the same priced prefix and replacement generation; meaningful range changes or model-route changes permit a fresh attempt. Manual compaction and overflow recovery retain their separate behavior, and transient provider failures do not become permanent suppression.

## Alternatives considered

**Disable connected tools or reduce model reasoning.** These reduce capabilities or change the requested model policy without addressing repeated fixed context and useless summary requests.

**Truncate every schema and instruction.** Argument constraints and operating instructions carry behavior; blind truncation can make valid operations inaccessible or unsafe.

**Rely only on earlier compaction.** Summaries cannot remove the fixed tool catalog, and an early threshold can repeatedly select a tiny head.

## Consequences

Native requests avoid carrying unrelated MCP schemas. Discovery can add one tool round trip before first use; tools evicted from the bounded active window can be rediscovered. A selected oversized schema still costs its complete schema on the next request. Code Mode retains its full SDK cost. Deterministic pressure failures avoid repeated summary calls while genuine history growth, explicit compaction, and recoverable provider errors remain supported. Local keyless composition and regression tests establish behavior; production quota savings require subsequent usage observation.
