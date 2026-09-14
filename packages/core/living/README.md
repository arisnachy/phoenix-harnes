# `@phoenix-ai/dsh-living`

English | [中文](README.zh.md)

Service Definition for Phoenix's universal operational relationship with things it creates. `ctx.living` stores no domain taxonomy: every creation describes its own identity, target integration level, observable state, actions, events, resources, and actors.

## Contract

`LivingCreationManifest.kind` is descriptive text, never an enum. Integration levels are ordered `static` → `connected` → `reactive` → `controllable` → `inhabited`. A provider proves the achieved level with actual methods: live state, event subscription, action dispatch, and actors. A manifest may remain remembered while its provider is offline, so losing a runtime does not erase Phoenix's identity for that creation.

`LivingRegistry.remember()` persists or replaces a manifest through the active provider implementation. `attach()` connects a live runtime and returns its disposer; disposing the provider leaves the manifest intact. `readState()` and `act()` fail loudly when live authority is unavailable.

## Model Experience

This package exposes no model tools by itself. `@phoenix-ai/dsh-tool-living` owns the standing creation rule and model controls, while generated plugins and adapters use `ctx.living.attach()` to connect their runtime.

## Limitations

The Service Definition deliberately owns neither transport nor storage. Out-of-process creations need an adapter that implements `LivingCreationProvider`; persistence belongs to the selected `ctx.living` implementation.
