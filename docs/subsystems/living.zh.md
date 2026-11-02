# Universal Living Creations

[English](living.md) | 中文

`ctx.living` 是 Phoenix 与其所创建一切内容之间、与领域无关的运行连接。每个创建物自行描述身份和能力；harness 不需要维护游戏、应用、文档、模拟器、服务、虚拟世界或未来创建类型的固定分类表。

## 集成级别

级别依次为 `static`、`connected`、`reactive`、`controllable` 和 `inhabited`。创建物选择真正有意义的最高级别。`static` 保留持久身份和资源；`connected` 增加权威实时状态；`reactive` 增加已声明事件；`controllable` 增加已声明动作；`inhabited` 增加可由 Phoenix 或其 agent 操作的参与者。

目标级别来自创建物 manifest；实际达到级别来自当前连接提供者的真实方法，绝不只依据元数据。提供者丢失后 manifest 仍会被记住，只是变为离线，因此之后的进程或适配器可以使用同一个 creation id 重新连接。

## 角色

[`@phoenix-ai/dsh-living`](../../packages/core/living/README.zh.md) 是 Service Definition。[`@phoenix-ai/dsh-living-local`](../../packages/core/living-local/README.zh.md) 是持久化进程内 Provider。[`@phoenix-ai/dsh-tool-living`](../../packages/core/tool-living/README.zh.md) 是模型侧 Consumer，负责应用通用创建规则，并暴露注册、检查、状态、动作和完成验证工具。

Cordis visual workspace 可以展示创建物，但不提供运行权限。HARDNESS 可以描述现有能力，但不拥有创建物执行。运行在 Phoenix 进程之外的创建物需要一个能够挂载 `LivingCreationProvider` 的适配器。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
