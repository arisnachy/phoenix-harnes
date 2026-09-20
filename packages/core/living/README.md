# `@phoenix-ai/dsh-living`

English | [中文](README.zh.md)

Service Definition for Phoenix's universal operational relationship with things it creates. `ctx.living` stores no domain taxonomy: every creation describes its own identity, target integration level, observable state, actions, events, resources, and actors.

## Contract

`LivingCreationManifest.kind` is descriptive text, never an enum. Integration levels are ordered `static` → `connected` → `reactive` → `controllable` → `inhabited`. A provider proves the achieved level with actual methods: live state, event subscription, action dispatch, and actors. A manifest may remain remembered while its provider is offline, so losing a runtime does not erase Phoenix's identity for that creation.

`LivingRegistry.remember()` persists or replaces a manifest through the active provider implementation. `attach()` connects a live runtime and returns its disposer; disposing the provider leaves the manifest intact. `readState()` and `act()` fail loudly when live authority is unavailable. `controlEndpoint()` exposes the provider-selected endpoint generated runtimes should use for Phoenix's universal control transport.

## Model Experience

### Living creation service

#### What the model sees

This package adds no tool or prompt text by itself. When `@phoenix-ai/dsh-tool-living` is composed, that consumer exposes the standing creation policy and the model-facing living tools over this service. Direct in-process callers may attach a provider without changing model context.

#### Token effect

The Service Definition adds zero tokens on its own. Model-visible tokens come only from consumers such as `@phoenix-ai/dsh-tool-living` and from their tool results.

#### KV Cache effect

None on its own. Provider attachment and live creation state stay outside the model request until a consumer explicitly projects them.

## Known Limitations and Deferred Work

- The Service Definition deliberately owns neither storage nor one mandatory transport implementation; concrete providers decide persistence and connection mechanics.
- The built-in local provider uses an owner-local HTTP bridge. Remote or cloud deployments need another provider or transport while preserving the same `ctx.living` contract.
