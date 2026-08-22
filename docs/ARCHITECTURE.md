# PHOENIX architecture

## Stable microkernel, replaceable edges

PHOENIX separates a small stable runtime contract from volatile provider and product integrations. Providers, models and external tool ecosystems change quickly; routing evidence and failure semantics must not.

The core knows only normalized requests/responses, provider/model capabilities, route decisions, execution outcomes, adapter lifecycle and ledger events. Provider-specific behavior lives behind adapters.

## Universal Provider Contract

A provider definition describes identity, endpoint/protocol, authentication reference, locality and models. A provider adapter executes requests for that definition. Credentials are referenced by environment-variable name and are never written into ledger payloads.

A model declares capabilities independently of its marketing name. The router can reject it before execution when a task requires unsupported tools, JSON output, reasoning, modalities or context.

## Routing

Routing has two stages:

1. **Hard constraints** eliminate incompatible or unavailable candidates.
2. **Policy scoring** orders survivors by free/local preference, quality metadata, provider preference and observed health.

The route decision records both selected candidates and rejected candidates with reasons.

## Failure semantics

Provider failure is data, not mission failure. PHOENIX walks an ordered fallback chain. Rate limits, transient upstream errors and transport failures are retryable. Permanent request failures stop instead of blindly replaying a bad request across every provider.

Repeated failures mark a provider unavailable in the in-process health model, creating the Genesis circuit breaker.

## Ledger

Genesis uses an in-memory append-only SHA-256 hash chain. Durable SQLite/Postgres implementations will preserve the same event contract. Secrets and authorization headers are outside the ledger boundary.

## Evolution boundary

The evolution engine consumes sanitized execution observations. It can recommend evidence-backed policy changes, but every recommendation carries `requiresApproval: true`. Applying recommendations is deliberately separate from generating them.

This lets PHOENIX evolve from empirical performance without silently rewriting production behavior.

## Planned seams

- native Anthropic, Gemini and other adapters;
- automatic model discovery and capability probes;
- MCP and general tool fabric;
- sandbox backends;
- durable ledger stores;
- multi-agent scheduler with a new PHOENIX-specific identity system;
- semantic memory;
- benchmark-driven task classification;
- privacy/offline/enterprise policy packs;
- UI and remote control plane.
