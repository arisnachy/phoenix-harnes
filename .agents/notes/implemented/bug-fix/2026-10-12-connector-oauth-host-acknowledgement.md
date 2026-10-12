# Agent Note: MCP OAuth Host acknowledgement

Status: implemented

English | [中文](2026-10-12-connector-oauth-host-acknowledgement.zh.md)

## Problem

The browser limits `authorization.begin` to twelve seconds. The Host created a pending attempt and immediately invoked the provider before resolving its RPC. Some OAuth flows can perform synchronous work before their first suspension, delaying the initial acknowledgement although the attempt already exists. The browser's timeout message also hardcoded Notion, obscuring failures in Slack and Meta integrations.

## Decision

The Host records the attempted key and method synchronously but schedules provider execution for the next event-loop turn. The initial RPC can then resolve without waiting for OAuth preparation. If a user cancels before the provider starts, the Host marks the attempt cancelled and releases the pending key without running the provider.

The browser identifies the connector that actually timed out and reports a missing Host acknowledgement rather than an upstream OAuth failure. It does not label the connection authorized or invent a provider URL.

## Alternatives considered

**Increase the twelve-second RPC timeout.** Rejected because extra waiting would disguise Host starvation and leave the same misleading message.

**Begin provider work synchronously and optimize each connector individually.** Rejected because an independent provider can introduce the same startup delay; the Host's acknowledgement must be provider-independent.

## Consequences

The local Host start request is separated from provider OAuth work. The provider can still fail OAuth discovery, client registration, redirect validation, or consent after the initial acknowledgement. In particular, this change does not bypass Slack's registered OAuth client requirement, turn consumer WhatsApp into the Business Cloud API, or remove Meta's OAuth compatibility constraints. Actual readiness still requires a live MCP connection and discovered tools.

## Verification

Regression tests cover acknowledgement before provider startup, cancellation before startup, existing OAuth status and prompt behavior, and provider-specific timeout text for Slack and the two Meta connectors. The files were edited through GitHub; live Windows Host, Slack and Meta OAuth tests were not executed in the authoring environment. CI and provider-authorized checks are required before claiming operational connections.
