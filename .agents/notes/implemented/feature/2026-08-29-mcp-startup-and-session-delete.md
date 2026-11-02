# Agent Note: MCP startup resilience and physical session deletion

Status: implemented

English | [中文](2026-08-29-mcp-startup-and-session-delete.zh.md)

## Problem

The optional MCP connector can wait on external npm or authentication work during startup, preventing the browser from reaching a usable host. Phoenix also lacked a physical session-delete path, leaving deleted UI rows recoverable in the persistence backend.

## Decision

Optional MCP activation now has a bounded `startupTimeoutMs` (default five seconds). A non-fatal timeout lets the Web host finish boot while the connector retries in the background; strict startup still fails closed. `session.delete` rejects active sessions, serializes deletion against per-session writes and prepared state, removes JSONL directories or SQLite rows with cascaded events, clears workspace indexes, and requires browser confirmation.

## Alternatives considered

**Wait indefinitely for every connector.** This keeps startup strict but makes one external service prevent the local Web host from serving.

**Hide sessions without deleting their records.** This avoids backend work but violates the physical-delete requirement and leaves recoverable data behind.

## Consequences

The observed local Web host returned HTTP 200 before and after a six-second interval and referenced `@phoenix-ai/dsh-client-modules/client.js` without the old namespace. Physical deletion is covered by focused JSONL and Host/UI tests. External MCP credentials and third-party services still require their own live receipts.
