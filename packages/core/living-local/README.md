# `@phoenix-ai/dsh-living-local`

English | [中文](README.zh.md)

Durable process-local implementation of `ctx.living`. It keeps creation manifests in an owner-private versioned JSON document and exposes an authenticated loopback control bridge so Phoenix-created apps, sites, services, simulations, and dashboards can reconnect after process restarts.

## Behavior

Startup restores remembered manifests as offline creations. Durable `remember()` and `forget()` mutations run through one serialized commit queue, so concurrent updates cannot overwrite one another. Each mutation atomically writes the next complete catalog before publishing it in memory; a failed write leaves both the in-memory manifest set and any attached provider unchanged.

`attach()` validates that a provider can reach the manifest's target level, subscribes only to events declared by the current committed manifest, and reports the achieved level from real provider methods. Replacing a manifest while a provider is attached is admitted only when that provider satisfies the new contract; if a provider changes during the durable write and no longer satisfies the committed manifest, it is detached rather than left falsely connected. Provider disposal changes connectivity but never deletes the manifest.

For out-of-process creations, the built-in `phoenix-living-http-v1` bridge binds to loopback, authenticates each creation with its own bearer secret, verifies the runtime's exact declared state/actions/events/actors, accepts state and telemetry/event updates, and queues Phoenix actions until the runtime returns a result. Heartbeat expiry or disconnect detaches only the live provider; the durable manifest remains available for reconnection.

## Model Experience

Indirectly, through `@phoenix-ai/dsh-tool-living`, the model reaches this package's durable creation state and authenticated control bridge rather than calling the backend directly.

#### KV Cache effect

No prompt or schema is registered here, so this backend adds no direct repeated model-context cost; cache changes are owned by the model-facing `dsh-tool-living` consumer.

## Known Limitations and Deferred Work

- The built-in bridge intentionally binds only to loopback and is designed for owner-local runtimes or a trusted server-side sidecar. A public browser-only bundle cannot safely hold its bearer secret; such deployments need a server-side connector or another `LivingRegistry` transport implementation.
