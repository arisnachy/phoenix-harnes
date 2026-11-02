# Agent Note: Allowlisted Home Assistant gateway

Status: implemented

English | [中文](2026-08-30-home-assistant-gateway.zh.md)

## Problem

PHOENIX had no model-facing route for the user's connected home devices. A broad LAN connector would expose an unsafe discovery and control surface, while a generic HTTP tool would bypass the harness permission model.

## Decision

The Home group adds a Home Assistant REST capability and a separate model-facing tool consumer. The capability accepts only a private or local endpoint, resolves the token at request time from an environment variable, filters state reads by entity allowlist, and checks both entity and fully qualified service allowlists before control calls. The base bundle mounts both rows only when `PHOENIX_HOME_ASSISTANT_URL` is present; missing or empty allowlists fail configuration instead of silently granting access.

The consumer exposes `home_list_devices` and `home_control`, forwards cancellation, contributes explicit model guidance, and renders generic execute cards without credentials. No automatic LAN discovery or arbitrary device protocol is included.

## Consequences

The model can operate approved Home Assistant devices through the same tool registry and mission-failure semantics as other tools. A user must intentionally configure the endpoint, token variable, entity JSON list, and service JSON list before the feature appears.

## Alternatives considered

Direct model-controlled LAN requests were rejected because they would bypass endpoint and operation policy. Embedding the token in the patch was rejected because credentials must remain outside configuration and logs. A Home Assistant-specific provider was selected over a universal gateway because its API and allowlist semantics are testable and bounded.

## Testing

The gateway tests cover private-endpoint validation, token forwarding, entity filtering, preflight denial, and approved control. The tool tests cover model schemas, prompt guidance, delegation, and cancellation forwarding. Both focused test files pass, and the package typecheck passes.
