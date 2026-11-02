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

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxliving--livingregistry-abstract-seam"></a>

### `ctx.living` — `LivingRegistry` (abstract seam)

Service Definition for every creation Phoenix keeps operationally connected. Implementations persist manifests separately from ephemeral provider attachments.

```ts cordis-catalog
/**
 * Resolve the endpoint generated runtimes should use for the universal control transport.
 * Providers with dynamic binding may override this; the default follows Phoenix's host/port environment.
 * @returns Fully qualified base endpoint for living runtime control.
 */
controlEndpoint(): Promise<string>

/**
 * Persist or replace one self-describing creation manifest.
 * @param manifest - Durable identity and declared capabilities to remember.
 * @returns Snapshot after the manifest has been committed.
 */
abstract remember(manifest: LivingCreationManifest): Promise<LivingCreationSnapshot>

/**
 * Explicitly delete one remembered creation and detach any live provider.
 * @param id - Creation whose durable identity should be removed.
 */
abstract forget(id: LivingCreationId): Promise<void>

/**
 * List fresh snapshots in stable registration order.
 * @returns Current remembered creations with connection and achieved-level state.
 */
abstract list(): LivingCreationSnapshot[]

/**
 * Inspect one remembered creation or throw when unknown.
 * @param id - Creation to inspect.
 * @returns Fresh manifest and live integration status.
 */
abstract inspect(id: LivingCreationId): LivingCreationSnapshot

/**
 * Attach an effect-owned runtime provider; disposing it leaves the manifest remembered but offline.
 * @param id - Remembered creation receiving the live provider.
 * @param provider - Runtime implementation for state, events, actions, and actors.
 * @returns Idempotent disposer for this exact provider attachment.
 */
abstract attach(id: LivingCreationId, provider: LivingCreationProvider): () => void

/**
 * Read authoritative live state.
 * @param id - Connected creation to read.
 * @returns State supplied by the currently attached provider.
 */
abstract readState(id: LivingCreationId): Promise<LivingState>

/**
 * Execute one declared live action.
 * @param id - Connected creation that owns the action.
 * @param action - Action name declared by the creation manifest.
 * @param input - JSON-compatible payload passed to the provider.
 * @returns JSON-compatible provider result.
 */
abstract act(id: LivingCreationId, action: string, input: LivingJson): Promise<LivingJson>

/**
 * Subscribe to committed registry and connectivity changes.
 * @param listener - Observer invoked with the affected creation id.
 * @returns Disposer that unregisters only this observer.
 */
abstract onChanged(listener: LivingChangedListener): () => void

/**
 * Subscribe to declared events emitted by connected creations.
 * @param listener - Observer receiving creation id, event name, and JSON data.
 * @returns Disposer that unregisters only this observer.
 */
abstract onCreationEvent(listener: LivingCreationEventListener): () => void
```

Source: [`packages/core/living/src/index.ts`](../../packages/core/living/src/index.ts)
<!-- END GENERATED cordis-surface -->
