# Universal Living Creations

English | [中文](living.zh.md)

`ctx.living` is Phoenix's domain-neutral operational connection to everything it creates. A creation describes its own identity and capabilities; the harness never needs a fixed taxonomy of games, applications, documents, simulations, services, virtual worlds, or future creation kinds.

## Integration levels

The ordered levels are `static`, `connected`, `reactive`, `controllable`, and `inhabited`. A creation chooses the strongest level that is genuinely meaningful. `static` preserves durable identity and resources. `connected` adds authoritative live state. `reactive` adds declared events. `controllable` adds declared actions. `inhabited` adds actors that Phoenix or its agents can operate.

The target comes from the creation manifest. The achieved level comes from the currently attached provider's real methods, never from metadata alone. Losing the provider leaves the manifest remembered but offline, allowing a later process or adapter to reconnect by the same creation id.

## Roles

[`@phoenix-ai/dsh-living`](../../packages/core/living/README.md) is the Service Definition. [`@phoenix-ai/dsh-living-local`](../../packages/core/living-local/README.md) is the durable process-local provider. [`@phoenix-ai/dsh-tool-living`](../../packages/core/tool-living/README.md) is the model-facing Consumer that applies the universal creation rule and exposes registration, inspection, state, action, and completion-verification tools.

Cordis visual workspace can present a creation but does not provide operational authority. HARDNESS can describe available capabilities but does not own creation execution. A creation running outside the Phoenix process needs an adapter that attaches a `LivingCreationProvider`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->
<!-- END GENERATED cordis-surface -->
