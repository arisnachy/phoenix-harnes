# Agent Note: Model connector inventory

Status: implemented

English | [中文](2026-08-29-model-connector-inventory.zh.md)

## Problem

PHOENIX could expose connected MCP tools and a browser authorization panel, but the model had no read-only operation for determining which authorization flows or provider services were available before choosing a connector capability. MCP tools also had no model-safe lifecycle state, so a server that was reconnecting or permanently failed could not be distinguished from a ready server.

## Decision

The HARDNESS adapters register `connector_list` whenever the authorization seam is mounted. The tool projects flow identifiers, labels, methods, in-flight state, and provider-owned connector telemetry into a closed model-facing result. It treats successful telemetry as `connected`, a successful empty inspection as `not-connected`, and a failed inspection as `unknown`.

The tool is inventory-only. It does not call `authorization.begin()`, disconnect accounts, grant permissions, or copy credential records. Service telemetry is explicitly rebuilt from the closed authorization type and excludes account identity, usage, URLs, and arbitrary provider payloads.

The base composition mounts `McpConnectorRegistry` at `ctx.mcpConnectors`. Each MCP client publishes its transport, lifecycle status, stable reason code, and public tool names through a reversible registration. The supervisor retains names during bounded recovery, clears them after retry exhaustion, and emits `auth-required` only for an explicit Streamable HTTP 401 or 403. Configuration, credentials, URLs, headers, environment variables, and raw provider errors never enter the registry or `connector_list`.

## Alternatives considered

**Let the model infer connector state from tool errors.** Rejected: an unavailable credential and an unavailable provider would be indistinguishable, and the model would need to attempt an action to learn a read-only fact.

**Expose the full authorization telemetry object.** Rejected: the browser contract permits account and usage metadata, but model inventory only needs service availability and must keep that surface narrower.

**Let `connector_list` start OAuth.** Rejected: authorization is a human interaction owned by the browser/API surface; a model-facing read operation must not turn discovery into an authority grant.

**Infer MCP state from registered tool names.** Rejected: names cannot represent a server with no discovered tools or distinguish a ready generation from a reconnecting or failed transport.

## Consequences

Every normal base profile with authorization now gives the model a stable, auditable connector inventory alongside `hardness_run`. Connected MCP tools remain governed by their existing tool, approval, sandbox, and session-log paths. Providers without safe telemetry remain visible as `unknown`, so the model must not claim that a connector is ready from flow registration alone.

MCP entries are visible even when unavailable, which lets the model explain a bounded failure without retrying blindly. A disconnected entry may retain its last tool names while recovery is in progress; the model must honor the lifecycle status before selecting one of those tools.
