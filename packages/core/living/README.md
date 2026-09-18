# `@phoenix-ai/dsh-living`

English | [中文](README.zh.md)

Service Definition for Phoenix's universal operational relationship with things it creates. `ctx.living` stores no domain taxonomy: every creation describes its own identity, target integration level, observable state, actions, events, resources, and actors.

## Contract

`LivingCreationManifest.kind` is descriptive text, never an enum. Integration levels are ordered `static` → `connected` → `reactive` → `controllable` → `inhabited`. A provider proves the achieved level with actual methods: live state, event subscription, action dispatch, and actors. A manifest may remain remembered while its provider is offline, so losing a runtime does not erase Phoenix's identity for that creation.

`LivingRegistry.remember()` persists or replaces a manifest through the active provider implementation. `attach()` connects a live runtime and returns its disposer; disposing the provider leaves the manifest intact. `readState()` and `act()` fail loudly when live authority is unavailable. `controlEndpoint()` exposes the provider-selected endpoint generated runtimes should use for Phoenix's universal control transport.

## Model Experience

This package exposes no model tools by itself. `@phoenix-ai/dsh-tool-living` owns the standing creation rule and model controls. In-process plugins may still use `ctx.living.attach()` directly; the default local implementation also supplies an authenticated bridge for generated out-of-process runtimes.

## Known Limitations and Deferred Work

The Service Definition deliberately owns neither storage nor one mandatory transport implementation. Concrete providers decide persistence and connection mechanics. The built-in local provider uses an owner-local HTTP bridge; remote/cloud deployments can replace that transport while preserving the same `ctx.living` contract.
