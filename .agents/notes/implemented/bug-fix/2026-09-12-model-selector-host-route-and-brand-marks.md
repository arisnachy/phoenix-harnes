# Agent Note: Model selector owns one HARDNESS route and bundled provider marks

Status: implemented

English | [中文](2026-09-12-model-selector-host-route-and-brand-marks.zh.md)

## Problem

The base Cordis composition mounts `@phoenix-ai/dsh-hardness-adapters` as a host capability while the `standard` and `cordis` presets mount the same package as a model-facing adapter. Both instances observed `connection` and registered `/hardness`, so resuming a session failed with a duplicate prefix route before model selection could run. The selector also fetched provider marks from a CDN, which made provider identity depend on a network request.

## Decision

`modelTools: false` is the ownership signal for the host adapter. Only that instance installs `installHardnessMissionRuntime` and watches for a late host connection. A `modelTools: true` preset instance registers its scoped `hardness_run` tool and protocol without registering the host RPC route.

The model selector renders bundled SVG paths for recognized providers. OpenAI uses its local brand path; Gemini, OpenRouter, DeepSeek, Anthropic, Mistral, Meta, NVIDIA, Hugging Face, Ollama, Perplexity, Qwen, Kimi, Moonshot, and Alibaba use packaged Simple Icons data. Unknown provider ids retain a monogram and never trigger guessed network traffic.

The effort pane continues to render the exact per-model reasoning metadata supplied by the host, including descriptions, defaults, and provider-specific ids. It submits the selected effort with the provider and model ids instead of maintaining a client-side effort vocabulary.

## Alternatives considered

**Make `/hardness` registration idempotent across every adapter instance.** Rejected: shared route registration would hide an ownership error and could let one session disposer remove the host route owned by another instance.

**Keep the CDN request and improve its fallback.** Rejected: a provider mark is presentation data that can be shipped with the selector; a network dependency adds latency and an avoidable failure mode to model selection.

**Hard-code one effort list for every provider.** Rejected: reasoning support and wire ids belong to the resolved model adapter, so a fixed list would offer controls a provider cannot honor or discard supported levels.

## Consequences

The host contributes one `/hardness` route regardless of how many full presets are mounted, while each session retains its own model-facing tool. Resuming a model-selection session no longer fails during preset mounting because of duplicate route ownership.

Known provider marks work offline and keep the original provider paths in the shipped client bundle. Unknown or custom providers remain identifiable without claiming an unsupported brand. The UI does not request provider logos or use a logo failure as a model-operation error.

## Testing

The focused adapter and React suites pass 14 tests, including host-only route registration, session-only tool registration, bundled marks for Gemini, OpenAI, OpenRouter, and DeepSeek, and the full `low`/`medium`/`high`/`xhigh`/`max` effort set. The repository build passes TypeScript host/client compilation, all package bundles, and the Vite frontend build.
