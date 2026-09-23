# Agent Note: Connector authorization signals

Status: implemented

English | [中文](2026-09-15-connector-authorization-signals.zh.md)

## Problem

Two independent defects hid whether a connector was authenticated.

A remote MCP server that rejects an unauthenticated request answers 401. The MCP SDK raises `StreamableHTTPError`, which carries the HTTP status in `code`; the connection supervisor read only `status`, so the rejection fell through to the generic failure path. The connector was published as `failed` with reason `connection-failed`, consumed its whole reconnect budget, and ended `retry-exhausted` — a state that neither asks the user to authorize nor preserves the actionable reason. The model-facing inventory could not distinguish "needs authorization" from "broken".

Separately, the pi-ai provider authorization flows registered `key`, `label`, `methods`, and `run`, but no `inspect`. A flow is published as connected only when its inspection returns telemetry, so every provider whose credential the user had already stored still read as `not-connected`, including providers holding a stored API key or OAuth grant.

## Decision

`httpStatus` in the MCP client reads a numeric `status` first and falls back to a numeric `code`, so a Streamable HTTP rejection is classified as an authorization demand regardless of which field the thrower used. A non-numeric `code` — a Node network code such as `ECONNREFUSED` — is not an HTTP status and still reports a connection failure. 401 and 403 keep their existing meaning: the connector becomes `auth-required` with reason `authorization-required`, and the reconnect budget is not spent on a server that will keep refusing until the user authorizes.

Each pi-ai provider flow now declares `inspect`, which reads the credential records and answers account telemetry only for the record that flow owns: `accountType` is `apiKey` for an api-key record and `oauth` for a grant. No record means no telemetry, so an unauthenticated provider still reads as not connected. The telemetry names the provider and the credential kind and carries no secret material, matching the closed telemetry contract the authorization seam already enforces.

## Consequences

Authorization required by a remote MCP connector is now visible in the connector inventory through the existing `auth-required` status and `authorization-required` reason code, which is what a status surface and the model both read; no new status or reason code was introduced. Providers whose credential is already stored stop being reported as not connected, so a settings surface that filters on connected entries no longer hides routes the user has already authenticated.

The classification still depends on the failure reaching the supervisor as a rejection object; a transport that swallows its own 401 continues to report a connection failure. `UnauthorizedError` handling is unchanged and still covers the path where the transport holds an OAuth provider.

## Verification

`packages/mcp/mcp-client/tests/apply.spec.ts` covers the SDK form of the rejection (`code: 401`) as `auth-required` and a non-numeric network code as `connection-failed`, alongside the existing `status: 401` case; the file passes with 24 tests.

`packages/llm/llm-pi-ai/tests/login.spec.ts` gains a grant case and an api-key case asserting the inspection telemetry, including the empty answer before any credential is stored. The pi-ai package tests could not be executed in the authoring environment because its dependency tree holds incomplete copies of `typebox` and `zod-to-json-schema`; the cases are written to fail against the previous implementation.

## Alternatives considered

- **Treat every transport failure as an authorization failure** — rejected because network errors such as `ECONNREFUSED` must remain distinguishable from HTTP 401/403.
- **Infer provider connection state from configured methods without inspecting stored credentials** — rejected because a configured flow is not evidence that the user has authenticated it.
- **Expose credential material in authorization telemetry** — rejected because connected-state telemetry only needs provider identity and credential kind, never the secret itself.
