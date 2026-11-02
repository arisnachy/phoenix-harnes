# MCP connector inventory design

English | [中文](2026-08-29-mcp-connector-inventory-design.zh.md)

## Problem

PHOENIX exposes MCP tools in the shared tool registry, but the model cannot distinguish a connected server from a server that is starting, disconnected, retrying, or permanently failed. The authorization inventory covers credential-obtaining flows only, so it cannot describe the transport-owned connector state or the public tools currently supplied by an MCP server.

## Decision

Add a process-local `McpConnectorRegistry` service at `ctx.mcpConnectors`. Each MCP client instance registers one server identity and receives a reversible handle for status and public-tool updates. The MCP connection supervisor publishes `starting`, `ready`, `disconnected`, `failed`, and evidence-backed `auth-required` states; it retains the last known public tool names while reconnecting and clears them after final failure. Registry entries contain only the server name, transport, status, stable reason code, and model-facing public tool names. Commands, URLs, headers, environment variables, credentials, and raw provider errors never cross the registry.

Extend the existing read-only `connector_list` tool to merge authorization flows with MCP registry entries. Authorization entries retain their current sanitized telemetry projection. MCP entries use `kind: mcp`, expose the transport and public tool names, and never invoke a connection, authorization flow, or tool call. The registry and inventory remain optional for minimal test contexts; the shipped base composition mounts the registry so normal MCP profiles receive live state.

## Lifecycle and failure semantics

An MCP client publishes `starting` before its first connection attempt. A successful connection and tool synchronization publish `ready`. A lost established connection publishes `disconnected` while the supervisor may retry. A failed attempt publishes `failed`, unless the error carries an explicit HTTP 401 or 403 status for a Streamable HTTP transport, which publishes `auth-required`. Reconnection returns to `starting`; exhausted retries publish `failed` and remove the server's tools. Disposing the client removes its registry entry.

## Verification

Unit tests cover registry duplicate protection, reversible registration, state transitions, and sanitized snapshots. MCP supervisor tests cover initial success, reconnect, final failure, and explicit HTTP authorization failure. HARDNESS adapter tests cover merged authorization/MCP output, absence of secret-bearing fields, and reversible registration. A keyless assembled snapshot proves the model-visible inventory schema and status vocabulary.

## Alternatives considered

**Infer servers from `mcp__<server>__<tool>` names.** Rejected because tool names cannot represent a server with no discovered tools or distinguish reconnecting and failed states.

**Extend the authorization service to own MCP state.** Rejected because authorization owns credential acquisition while MCP owns transport and tool generations; combining them would make either lifecycle incomplete.

**Expose the MCP configuration to the model.** Rejected because commands, URLs, headers, environment variables, and credentials are deployment data rather than safe connector status.

## Consequences

The model can choose an MCP tool using current, sanitized connection evidence and can explain an unavailable integration without guessing from a tool error. A disconnected server may remain visible with its last tool names during bounded recovery, so the model must honor the status rather than treat names alone as callable. Minimal compositions without the registry keep existing MCP client behavior and tests, while the PHOENIX profile gains a single inventory source for authorization and MCP connectors.
