# Agent Note: Model connector inventory

Status: implemented

English | [中文](2026-08-29-model-connector-inventory.zh.md)

## Problem

PHOENIX could expose connected MCP tools and a browser authorization panel, but the model had no read-only operation for determining which authorization flows or provider services were available before choosing a connector capability.

## Decision

The HARDNESS adapters register `connector_list` whenever the authorization seam is mounted. The tool projects flow identifiers, labels, methods, in-flight state, and provider-owned connector telemetry into a closed model-facing result. It treats successful telemetry as `connected`, a successful empty inspection as `not-connected`, and a failed inspection as `unknown`.

The tool is inventory-only. It does not call `authorization.begin()`, disconnect accounts, grant permissions, or copy credential records. Service telemetry is explicitly rebuilt from the closed authorization type and excludes account identity, usage, URLs, and arbitrary provider payloads.

## Alternatives considered

**Let the model infer connector state from tool errors.** Rejected: an unavailable credential and an unavailable provider would be indistinguishable, and the model would need to attempt an action to learn a read-only fact.

**Expose the full authorization telemetry object.** Rejected: the browser contract permits account and usage metadata, but model inventory only needs service availability and must keep that surface narrower.

**Let `connector_list` start OAuth.** Rejected: authorization is a human interaction owned by the browser/API surface; a model-facing read operation must not turn discovery into an authority grant.

## Consequences

Every normal base profile with authorization now gives the model a stable, auditable connector inventory alongside `hardness_run`. Connected MCP tools remain governed by their existing tool, approval, sandbox, and session-log paths. Providers without safe telemetry remain visible as `unknown`, so the model must not claim that a connector is ready from flow registration alone.
