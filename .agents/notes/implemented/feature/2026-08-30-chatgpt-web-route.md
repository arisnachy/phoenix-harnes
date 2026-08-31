# Agent Note: ChatGPT Web bridge route

Status: implemented

English | [中文](2026-08-30-chatgpt-web-route.zh.md)

## Problem

PHOENIX could address arbitrary OpenAI-compatible gateways, but the optional local `codex-chatgpt-web` bridge had no named route or diagnostic. That made setup ambiguous and made an unavailable bridge look like a generic provider failure.

## Decision

`llm-pi-ai` now exposes `chatgpt-web` as a dormant configurable route. Once a profile is stored, it resolves to the loopback bridge's OpenAI Responses endpoint (`http://127.0.0.1:17841/v1`) with the bridge's supported model names as defaults. Users may override the endpoint, protocol, models, and credential reference through the existing settings seam. No browser profile, cookie, password, or credential is imported by PHOENIX.

`dsh doctor` checks the bridge only when `PHOENIX_CHATGPT_WEB_URL` is explicitly set. It reads the model listing, reports only a bounded health result, and never prints response bodies or authorization data.

## Consequences

The Models page can expose a first-class ChatGPT Web option, while an unconfigured installation remains dormant. A configured but unavailable bridge is diagnosed as a local dependency problem rather than silently falling back to another provider.

This is the Phoenix-side bridge integration, not a bundled ChatGPT login. The upstream bridge remains responsible for browser authentication and its own security model.

## Alternatives considered

Bundling browser login into PHOENIX would require taking ownership of cookies and credentials, so the external bridge remains the authentication owner. Treating the bridge as an unnamed custom provider would hide its setup and health state, so it has a named dormant route and diagnostic.

## Testing

`packages/llm/llm-pi-ai/tests/config.spec.ts` verifies default route materialization, `packages/llm/llm-pi-ai/tests/catalog.spec.ts` verifies directory exposure, and `apps/cli/tests/doctor.spec.ts` verifies bounded bridge health parsing. The focused run passes 3 files and 83 tests.
