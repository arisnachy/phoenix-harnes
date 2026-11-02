# Agent Note: ChatGPT Web supplies local auth metadata to pi-ai

Status: implemented

English | [中文](2026-09-03-chatgpt-web-local-auth-marker.zh.md)

## Problem

The local `chatgpt-web` route uses browser-session authentication in its loopback bridge and intentionally has no model API key. pi-ai's OpenAI Responses implementation nevertheless rejects a request before network I/O unless it receives an API key or an authorization header, so the adapter reported `No API key for provider: chatgpt-web` as `PI_AI_ERROR`.

## Decision

The adapter adds `Bearer phoenix-chatgpt-web` only when the `chatgpt-web` route has no non-empty `Authorization` or `cf-aig-authorization` header. The value is a non-secret loopback marker for pi-ai's preflight; the bridge continues to authenticate the browser session, and configured headers remain authoritative.

## Alternatives considered

**Require a dummy API key in settings.** Rejected because it misrepresents browser-session authentication, adds unnecessary credential storage, and still permits the same preflight failure when the value is absent.

**Relax pi-ai's validation globally.** Rejected because other OpenAI-compatible routes may genuinely require credentials; changing them would hide configuration errors and weaken fail-loud behavior.

## Consequences

ChatGPT Web requests pass pi-ai's local validation without an API key and remain scoped to the loopback bridge. The focused adapter regression test covers the keyless route and the package README records the exception; bridge availability and browser sign-in remain separate runtime requirements.
