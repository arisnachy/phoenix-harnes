# Agent Note: Guided model provider settings in Pearl Light

Status: implemented

English | [中文](2026-11-21-guided-model-provider-settings.zh.md)

## Problem

Settings → Models exposed all provider profiles as long technical rows with repeated edit, reorder and delete controls. API keys, account authorization and advanced model catalogs appeared together, even though some providers offer only one connection method. The presentation differed from the rest of Phoenix and made an ordinary provider change feel like editing a configuration file.

## Decision

`ModelsSection` presents configured providers in a theme-token-based, searchable, responsive catalog. The explicit Organize action exposes the ordering context; the existing persisted `user-profile.modelProviderOrder` remains the source of truth. The same editor continues to serve both configured providers and adopted dormant providers, now using three guided steps: available connection methods, configuration, and review with an optional model-discovery check. `CustomProviderCard` uses identification, configuration and review steps. Editing a provider does not require recreating it.

Connection choices are derived from the account authorization flows registered by the Host. OpenAI Codex remains account-only and ChatGPT Web remains browser-backed; the UI does not invent an OAuth option for API-only providers. The API key remains a write-only credential handled by `credentials.set`, never stored in settings values. A successful account connection may remove a user-layer `apiKeyEnv` override without deleting the credential itself. The review screen distinguishes model discovery from a guaranteed end-to-end request: discovery failure does not erase a valid draft.

`ProviderEditor` and `CustomProviderCard` keep the existing direct editor posture when `guided` is absent. Settings opens them with guidance, while onboarding and other specialized consumers retain their current controls. The UI uses existing `--dsw-alias-*` tokens, avoiding theme-specific hardcoded colors.

## Alternatives considered

**Replace the settings and credential services.** Rejected: the current stores already protect secret values, accept revision-guarded mutations, and support model discovery.

**Require a model-discovery success to save.** Rejected: some adapters do not expose readable catalogs, and an endpoint may refuse discovery while still accepting inference requests.

**Apply one authentication method to every provider.** Rejected: API-key-only, account-only and local routes have different supported paths.

## Consequences

Users can choose a provider before dealing with keys and advanced configuration, and the same steps guide edits. Credential values remain outside settings snapshots. The final review offers a non-destructive connection probe, but saving alone is not presented as proof that inference works. The focused UI regression test checks navigation without writes.

## Follow-up: real OAuth and local Ollama management

Settings Models now opens theme-aware responsive modal wizards, not inline editor cards. Its authentication choices are obtained from actual Host authorization methods. Codex remains account-based; API-only and browser session routes remain separate. The Ollama Host enumerates installed tags through localhost /api/tags and probes /api/show for model-native context metadata. RAM-conservative operational limits, input and output budgets, and separately confirmed permanent deletion are exposed through sanitized Host Remote contracts. Explicit user installation calls /api/pull with progress; unlinking never deletes shared Ollama files. Oversized local prompts fail explicitly instead of silent truncation. No secrets or personal model inventories are stored in this public repository. Publication requires actual passing CI.

## OpenAI family routing follow-up

The first modal implementation exposed only API for `openai`, even though users naturally associate it with ChatGPT/Codex account authorization. This is a route-discovery issue, not a missing OpenAI API OAuth flow: `openai` is an API provider and `openai-codex` is a distinct provider backed by a native Codex session. The updated wizard presents both choices together when both routes exist and changes the underlying route on selection; it never mixes account grants with API credentials. Other OAuth choices still follow the real pi-ai authorization registry, and unsupported flows are never invented. In addition, account-list lookups now enforce the `llm-pi-ai/` scope or the exact native Codex key, preventing unrelated connected apps from being mistaken for model authentication. Registry failures are visible and retryable rather than silently degrading to API-only.
