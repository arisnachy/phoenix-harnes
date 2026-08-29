# Agent Note: Codex quota sidebar seat

Status: implemented

English | [中文](2026-08-29-codex-quota-sidebar-seat.zh.md)

## Problem

The quota seat was gated by the active model route. A user on another route could have a valid OpenAI/Codex account but could not see its five-hour or weekly usage beside Settings.

## Decision

The seat reads only sanitized OpenAI/Codex account telemetry from the authorization catalog. It is independent of the selected model provider, refreshes at a bounded interval, and renders only finite percentages reported by the provider. Missing or invalid telemetry produces no seat and no estimated value.

## Consequences

The account limit remains visible while the model route changes. The component does not expose credentials, raw authorization payloads, or token-derived estimates. A real five-hour or seven-day value still requires the authorization provider to publish that window.
