# Agent Note: ChatGPT Web settings card uses the local tunnel

Status: implemented

English | [中文](2026-09-03-chatgpt-web-tunnel-settings-card.zh.md)

## Problem

The Models card treated the browser-session `chatgpt-web` route like an API-key provider, so its setup surface invited a credential that the local bridge must never require.

## Decision

The `chatgpt-web` editor identifies the local tunnel, shows its effective endpoint, skips credential lookup and the API-key input, and leaves the route's model list selectable. The bridge remains responsible for browser authentication and lifecycle; the settings page does not claim that the bridge is currently reachable.

## Alternatives considered

**Keep the generic API-key field.** Rejected because it contradicts the route's browser-session authentication and encourages storing a meaningless paid credential.

**Add a second generic provider type.** Rejected because the route id already identifies the adapter-specific behavior and the existing profile/editor path is sufficient.

## Consequences

Selecting `chatgpt-web` no longer presents a paid API-key step. A running `codex-chatgpt-web` bridge and browser sign-in are still required for a successful request; `dsh chatgpt-web status` remains the availability check.
