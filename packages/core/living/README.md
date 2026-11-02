# `@phoenix-ai/dsh-living`

English | [中文](README.zh.md)

Service Definition for Phoenix's universal operational relationship with things it creates. `ctx.living` stores no domain taxonomy: every creation describes its own identity, target integration level, observable state, actions, events, resources, and actors.

## Contract

`LivingCreationManifest.kind` is descriptive text, never an enum. Integration levels are ordered `static` → `connected` → `reactive` → `controllable` → `inhabited`. A provider proves the achieved level with actual methods: live state, event subscription, action dispatch, and actors. A manifest may remain remembered while its provider is offline, so losing a runtime does not erase Phoenix's identity for that creation.

`LivingRegistry.remember()` persists or replaces a manifest through the active provider implementation. `attach()` connects a live runtime and returns its disposer; disposing the provider leaves the manifest intact. `readState()` and `act()` fail loudly when live authority is unavailable. `controlEndpoint()` exposes the provider-selected endpoint generated runtimes should use for Phoenix's universal control transport.

## Model Experience

Indirectly, through `@phoenix-ai/dsh-tool-living`, which owns the model-visible creation rule, tool schemas, and results over `ctx.living`.

#### KV Cache effect

This service definition adds no model tokens of its own; cache behavior is determined by the model-facing consumer that uses the seam.

## Known Limitations and Deferred Work

- The Service Definition intentionally does not prescribe persistence or a unique transport; concrete providers choose storage and connectivity while preserving the same `ctx.living` contract.
