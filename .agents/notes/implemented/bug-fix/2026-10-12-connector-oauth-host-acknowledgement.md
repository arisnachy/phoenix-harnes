# Agent Note: MCP OAuth Host acknowledgement

Status: implemented

## Problem

The browser limits `authorization.begin` to twelve seconds. The Host API creates a pending attempt and then immediately invokes `authorization.begin` on the provider before resolving its RPC. An OAuth provider may perform synchronous work before its first suspension, so the HTTP response can be starved even though the attempt itself has been created. The existing browser timeout message also hardcoded Notion, obscuring failures in Slack and Meta integrations.

## Decision

The Host records the attempted key and method synchronously but schedules provider execution for the next event-loop turn. The initial RPC can then resolve without waiting for OAuth preparation. If a user cancels before the provider starts, the Host marks the attempt cancelled and releases the pending key; a cancelled attempt never starts a provider.

The browser identifies the connector that actually timed out and reports that Host acknowledgement, not remote OAuth, failed. It does not label the connection authorized or invent a provider URL.

## Scope and limits

This change only addresses the local Host/RPC handoff and timeout diagnostics. It does not bypass Slack's registered OAuth client requirement, turn consumer WhatsApp into Business Cloud API, or remove Meta's server-side OAuth constraints. Those require a valid account, provider-approved redirect/client registration and a successful actual consent flow. Readiness still requires a live MCP connection and discovered tools.

## Verification

Regression tests cover acknowledgement before provider startup, cancellation before startup, the prior OAuth status/prompt path and provider-specific timeout text for Slack and Meta. The files were edited through the connected GitHub repository; no local PHOENIX Host or provider credentials were available in this environment, so full build and live OAuth validation are pending CI and Windows testing.
