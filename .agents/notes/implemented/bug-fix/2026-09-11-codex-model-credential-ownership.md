# Agent Note: Keep Codex model OAuth with the model provider

Status: implemented

English | [中文](2026-09-11-codex-model-credential-ownership.zh.md)

## Problem

Native Codex login and Codex model requests use different credential stores. The native bridge writes only the token-free `subagent-codex/account` marker, while model requests read and refresh `llm-pi-ai/openai-codex`. Disabling the latter record's authorization flow left an expired model grant with no supported replacement even when the native Codex account was connected.

## Decision

The `OpenAI Codex` authorization entry runs pi-ai's ChatGPT OAuth flow and writes the grant consumed by Codex model requests. The separate `ChatGPT / Codex` entry continues to represent the native Codex account for subagents and telemetry without exposing or copying its tokens.

## Alternatives considered

**Copy native Codex tokens into the model credential record.** This would couple two independent refresh owners and make PHOENIX parse and persist secrets that the native bridge deliberately leaves under Codex control.

**Treat the native account marker as model authorization.** The marker contains no credential and the pi-ai request path cannot authenticate with it, so presenting it as sufficient would preserve the failure.

**Run primary model requests through Codex app-server.** App-server owns a complete agent runtime rather than the harness LLM streaming API; using it as a token proxy would mix two tool loops and change session semantics.

## Consequences

Codex model users authorize the credential that model requests actually consume, and an expired grant can be replaced without copying native Codex secrets. The two account entries are intentionally independent, so signing in to native Codex does not authorize the model route. The focused login test pins that `llm-pi-ai/openai-codex` exposes OAuth through the assembled authorization service.
