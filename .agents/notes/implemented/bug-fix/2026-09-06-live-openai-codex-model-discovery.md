# Agent Note: Live OpenAI-Codex model discovery

Status: implemented

## Problem

The Models settings surface labels its action as fetching available models, but the `openai-codex` route was intercepted by the generic installed-catalog shortcut in `llm-pi-ai`. The picker therefore returned the model snapshot bundled with the installed pi-ai dependency instead of the models visible to the user's currently authenticated Codex account. A newly enabled or account-scoped Codex model could be absent, while a stale bundled entry could still be presented as available.

## Decision

`openai-codex` is the account-scoped exception to the installed-catalog discovery shortcut. `discoverModels()` routes it to a short-lived local Codex app-server and performs the app-server handshake over stdio (`initialize`, `initialized`) before reading the complete paginated `model/list` response with hidden entries excluded.

The app-server model's `model` field becomes the selectable Phoenix model id, with `id` accepted only as a compatibility fallback for older response shapes. `displayName` is retained for presentation. Pages are deduplicated by model id and discovery refuses an excessive page count rather than returning a silently partial result.

This path uses the Codex CLI's existing ChatGPT authentication and does not resolve a Phoenix API key. On Windows Phoenix starts the fixed `codex app-server` command through `ComSpec` so npm's `codex.cmd` shim is supported; on POSIX it launches `codex` directly. Only the ambient variables required for executable lookup, Codex configuration, platform operation, locale, proxying, and TLS trust are forwarded.

A Codex discovery failure is surfaced as a discovery failure. Phoenix does not fall back to the bundled pi-ai Codex catalog, because doing so would recreate the original defect while making a stale result look live.

## Alternatives considered

**Keep the pi-ai catalog as the authority.** Rejected because that catalog is a dependency snapshot, while Codex model availability is account-scoped and can change independently of a Phoenix release.

**Call an OpenAI-compatible `/v1/models` endpoint.** Rejected because the Codex route is authenticated through Codex/ChatGPT rather than a normal provider API key, and the account-aware model catalog belongs to the Codex app-server protocol.

**Use the static catalog as a fallback when app-server discovery fails.** Rejected because the Models surface would again be unable to distinguish a real account-visible list from stale local metadata. A visible failure is safer and diagnosable.

**Hard-code newly known Codex model ids in Phoenix.** Rejected because every subsequent Codex rollout would recreate the same maintenance race and would still not represent per-account availability.

## Consequences

The Settings model picker now reflects the models reported by the user's own authenticated Codex installation, including models unknown to the Phoenix dependency snapshot. Regression coverage pins the live-transport branch, forbids silent static fallback, verifies cancellation forwarding, and checks model-list mapping and hidden-row filtering.

Live discovery now depends on a working local Codex CLI and its authentication state. If Codex is absent, cannot start, cannot authenticate, or cannot obtain its model catalog, the picker reports failure instead of showing an invented or stale answer. The short-lived app-server adds process startup cost to an explicit user-triggered settings action, not to ordinary model execution.
