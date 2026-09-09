# Agent Note: Shared memory and MCP presentation fields

Status: implemented

English | [中文](2026-09-08-shared-memory-and-mcp-presentation-fields.zh.md)

## Problem

The automatic memory context and memory search result repeated the same cognitive-record projection, while the stdio and Streamable HTTP MCP schemas repeated the same namespace, timeout, startup, and reconnect fields. Separate copies could drift while still producing valid TypeScript.

## Decision

[`presentation.ts`](../../../../packages/session-learning/tool-session-learning/src/presentation.ts) owns the shared sanitized cognitive-record projection. Automatic context uses it directly, and search results extend it with entities, relations, status, score, and reasons; legacy memory records keep their separate projection.

[`index.ts`](../../../../packages/mcp/mcp-client/src/index.ts) defines common MCP configuration fields in one private schema-field object. The stdio and Streamable HTTP schemas explicitly name each shared field so the static catalog can enumerate them, while retaining transport discriminants, transport-specific fields, existing defaults, and validation.

## Verification

Focused Vitest coverage passed for the memory presentation, MCP plugin lifecycle, and MCP tool bridge: 3 files and 84 tests. Focused Oxlint and no-emit TypeScript checks passed for both changed source files.

## Alternatives considered

**Suppress the duplication reports:** rejected because an ignore would hide future drift in model-facing sanitization and MCP configuration validation.

**Keep parallel copies and update them together:** rejected because the repeated fields are one semantic projection and one configuration rule.

**Merge the legacy memory projection into the cognitive helper:** rejected because legacy records intentionally expose fewer fields and must retain their current output.

## Consequences

Changes to shared cognitive fields or MCP defaults now have one owning implementation. Transport-specific output, legacy memory output, sanitization, and public configuration behavior remain unchanged.
