/** Durable process-local provider for `ctx.living`. @module @phoenix-ai/dsh-living-local */

import { readFileSync } from 'node:fs'
import { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import { writeFileAtomic } from '@phoenix-ai/dsh-atomic-write'
import {
  DEFAULT_LIVING_CONTROL_HOST, DEFAULT_LIVING_CONTROL_PORT, LivingRegistry,
  livingLevelRank, livingProviderLevel, validateLivingManifest,
} from '@phoenix-ai/dsh-living'
import type {
  LivingChangedListener, LivingCreationEventListener, LivingCreationId, LivingCreationManifest,
  LivingCreationProvider, LivingCreationSnapshot, LivingJson, LivingState,
} from '@phoenix-ai/dsh-living'
import { LivingHttpBridge } from './bridge.ts'

interface PersistedDocument {
  readonly version: 1
  readonly creations: LivingCreationManifest[]
}

interface AttachedProvider {
  readonly provider: LivingCreationProvider
  readonly disposeSubscription: () => void
}

export interface Config {
  /** Owner-private JSON document containing remembered creation manifests. */
  path: string
  /** Loopback host for generated-runtime control. Defaults to PHOENIX_LIVING_CONTROL_HOST or 127.0.0.1. */
  bridgeHost?: string
  /** Loopback TCP port for generated-runtime control. Defaults to PHOENIX_LIVING_CONTROL_PORT or 32145. */
  bridgePort?: number
  /** Maximum time a queued Phoenix action may wait for the connected runtime. */
  bridgeActionTimeoutMs?: number
  /** Disconnect a runtime whose authenticated heartbeat/poll traffic goes stale beyond this bound. */
  bridgeHeartbeatTimeoutMs?: number
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readDocument(path: string): Map<LivingCreationId, LivingCreationManifest> {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map()
    throw error
  }
  const parsed = JSON.parse(raw) as Partial<PersistedDocument>
  if (parsed.version !== 1 || !Array.isArray(parsed.creations)) throw new Error(`living catalog ${path} has unsupported format`)
  const store = new Map<LivingCreationId, LivingCreationManifest>()
  for (const manifest of parsed.creations) {
    validateLivingManifest(manifest)
    if (store.has(manifest.id)) throw new Error(`living catalog ${path} contains duplicate creation ${manifest.id}`)
    store.set(manifest.id, clone(manifest))
  }
  return store
}

function envPort(): number | undefined {
  const raw = process.env.PHOENIX_LIVING_CONTROL_PORT?.trim()
  if (raw === undefined || raw.length === 0) return undefined
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`PHOENIX_LIVING_CONTROL_PORT must be an integer from 1 to 65535, got ${JSON.stringify(raw)}`)
  }
  return value
}

/** Process-local registry with durable manifest identity and ephemeral live providers. */
export class LocalLivingRegistry extends LivingRegistry {
  static Config: z<Config> = z.object({
    path: z.string().required(),
    bridgeHost: z.string(),
    bridgePort: z.number().step(1).min(0).max(65535),
    bridgeActionTimeoutMs: z.number().step(1).min(1),
    bridgeHeartbeatTimeoutMs: z.number().step(1).min(1),
  })

  private manifests: Map<LivingCreationId, LivingCreationManifest>
  private readonly providers = new Map<LivingCreationId, AttachedProvider>()
  private readonly changed = new Set<LivingChangedListener>()
  private readonly eventListeners = new Set<LivingCreationEventListener>()
  private mutationChain: Promise<void> = Promise.resolve()
  private readonly bridge: LivingHttpBridge

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
    if (config.path.length === 0 || config.path !== config.path.trim()) throw new TypeError('living-local path must be a non-empty normalized string')
    this.manifests = readDocument(config.path)
    this.bridge = new LivingHttpBridge(this, {
      host: config.bridgeHost ?? (process.env.PHOENIX_LIVING_CONTROL_HOST?.trim() || DEFAULT_LIVING_CONTROL_HOST),
      port: config.bridgePort ?? envPort() ?? DEFAULT_LIVING_CONTROL_PORT,
      ...(config.bridgeActionTimeoutMs === undefined ? {} : { actionTimeoutMs: config.bridgeActionTimeoutMs }),
      ...(config.bridgeHeartbeatTimeoutMs === undefined ? {} : { heartbeatTimeoutMs: config.bridgeHeartbeatTimeoutMs }),
    }, message => ctx.logger.warn(message))
    ctx.effect(() => () => this.disposeProviders(), 'living provider teardown')
  }

  async remember(manifest: LivingCreationManifest): Promise<LivingCreationSnapshot> {
    validateLivingManifest(manifest)
    const candidate = clone(manifest)
    return this.enqueueMutation(async () => {
      const attachedBefore = this.providers.get(candidate.id)
      if (attachedBefore !== undefined) this.assertProviderSupports(candidate, attachedBefore.provider)
      this.bridge.assertManifestCompatible(candidate)

      const next = new Map(this.manifests)
      next.set(candidate.id, candidate)
      await this.persist(next)
      this.manifests = next

      this.bridge.reconcile(candidate)

      // A provider may have detached/re-attached while the durable write was in flight.
      // Never retain a provider whose runtime contract no longer satisfies the committed manifest.
      const attachedAfter = this.providers.get(candidate.id)
      if (attachedAfter !== undefined && this.providerCompatibilityError(candidate, attachedAfter.provider) !== undefined) {
        this.providers.delete(candidate.id)
        try { attachedAfter.disposeSubscription() } catch { /* committed manifest wins over provider cleanup */ }
      }

      this.notifyChanged(candidate.id)
      return this.inspect(candidate.id)
    })
  }

  forget(id: LivingCreationId): Promise<void> {
    return this.enqueueMutation(async () => {
      this.requireManifest(id)
      const next = new Map(this.manifests)
      next.delete(id)
      await this.persist(next)

      this.manifests = next
      this.bridge.disconnect(id, 'living creation forgotten')
      const attached = this.providers.get(id)
      this.providers.delete(id)
      try { attached?.disposeSubscription() } catch { /* cleanup failures cannot roll back a committed forget */ }
      this.notifyChanged(id)
    })
  }

  list(): LivingCreationSnapshot[] {
    return [...this.manifests.keys()].map(id => this.snapshot(id))
  }

  inspect(id: LivingCreationId): LivingCreationSnapshot {
    this.requireManifest(id)
    return this.snapshot(id)
  }

  attach(id: LivingCreationId, provider: LivingCreationProvider): () => void {
    const manifest = this.requireManifest(id)
    if (this.providers.has(id)) throw new Error(`living creation ${id} already has a provider attached`)
    this.assertProviderSupports(manifest, provider)

    let active = true
    const emit = (name: string, data: LivingJson): void => {
      if (!active) return
      const currentManifest = this.manifests.get(id)
      if (currentManifest === undefined) return
      if (!currentManifest.events.includes(name)) throw new Error(`living creation ${id} emitted undeclared event ${JSON.stringify(name)}`)
      const event = { creationId: id, name, data: clone(data) }
      for (const listener of [...this.eventListeners]) {
        try { listener(event) } catch { /* observers cannot break the creation */ }
      }
    }
    let disposeSubscription = (): void => undefined
    const record: AttachedProvider = {
      provider,
      disposeSubscription: () => {
        active = false
        disposeSubscription()
      },
    }
    this.providers.set(id, record)
    try {
      disposeSubscription = provider.subscribe?.(emit) ?? (() => undefined)
    } catch (error) {
      this.providers.delete(id)
      active = false
      throw error
    }
    this.notifyChanged(id)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      const current = this.providers.get(id)
      if (current?.provider !== provider) return
      this.providers.delete(id)
      try { current.disposeSubscription() } catch { /* provider cleanup is isolated from registry state */ }
      this.notifyChanged(id)
    }
  }

  async readState(id: LivingCreationId): Promise<LivingState> {
    const manifest = this.requireManifest(id)
    const provider = this.providers.get(id)?.provider
    if (provider?.readState === undefined) throw new Error(`living creation ${id} is offline or has no live state provider`)
    const state = clone(await provider.readState())
    for (const key of Object.keys(state)) {
      if (!manifest.state.includes(key)) throw new Error(`living creation ${id} returned undeclared state key ${JSON.stringify(key)}`)
    }
    return state
  }

  async act(id: LivingCreationId, action: string, input: LivingJson): Promise<LivingJson> {
    const manifest = this.requireManifest(id)
    if (!manifest.actions.includes(action)) throw new Error(`living creation ${id} does not declare action ${JSON.stringify(action)}`)
    const provider = this.providers.get(id)?.provider
    if (provider?.act === undefined) throw new Error(`living creation ${id} is offline or not controllable`)
    return clone(await provider.act(action, clone(input)))
  }

  /** Actual loopback endpoint after the built-in control bridge has bound its port. */
  override controlEndpoint(): Promise<string> {
    return this.bridge.endpoint()
  }

  onChanged(listener: LivingChangedListener): () => void {
    this.changed.add(listener)
    return () => { this.changed.delete(listener) }
  }

  onCreationEvent(listener: LivingCreationEventListener): () => void {
    this.eventListeners.add(listener)
    return () => { this.eventListeners.delete(listener) }
  }

  private requireManifest(id: LivingCreationId): LivingCreationManifest {
    const manifest = this.manifests.get(id)
    if (manifest === undefined) throw new Error(`unknown living creation ${id}`)
    return manifest
  }

  private snapshot(id: LivingCreationId): LivingCreationSnapshot {
    const manifest = this.requireManifest(id)
    const provider = this.providers.get(id)?.provider
    return {
      manifest: clone(manifest),
      connected: provider !== undefined,
      achievedLevel: provider === undefined ? 'static' : livingProviderLevel(provider),
    }
  }

  private providerCompatibilityError(manifest: LivingCreationManifest, provider: LivingCreationProvider): Error | undefined {
    const achieved = livingProviderLevel(provider)
    if (livingLevelRank(achieved) < livingLevelRank(manifest.targetLevel)) {
      return new Error(`living provider for ${manifest.id} achieves ${achieved}, below target ${manifest.targetLevel}`)
    }
    if (manifest.targetLevel === 'inhabited') {
      const actorSet = new Set(provider.actors ?? [])
      const missing = manifest.actors.filter(actor => !actorSet.has(actor))
      if (missing.length > 0) return new Error(`living provider for ${manifest.id} is missing declared actors: ${missing.join(', ')}`)
    }
    return undefined
  }

  private assertProviderSupports(manifest: LivingCreationManifest, provider: LivingCreationProvider): void {
    const error = this.providerCompatibilityError(manifest, provider)
    if (error !== undefined) throw error
  }

  private notifyChanged(id: LivingCreationId): void {
    for (const listener of [...this.changed]) {
      try { listener(id) } catch { /* registry observers are isolated */ }
    }
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationChain.then(operation)
    this.mutationChain = result.then(() => undefined, () => undefined)
    return result
  }

  private persist(next: Map<LivingCreationId, LivingCreationManifest>): Promise<void> {
    const document: PersistedDocument = { version: 1, creations: [...next.values()].map(clone) }
    const content = `${JSON.stringify(document, null, 2)}\n`
    return writeFileAtomic(this.config.path, content, { mode: 0o600, dirMode: 0o700 })
  }

  private disposeProviders(): void {
    this.bridge.dispose()
    for (const attached of this.providers.values()) {
      try { attached.disposeSubscription() } catch { /* teardown isolates provider cleanup */ }
    }
    this.providers.clear()
    this.changed.clear()
    this.eventListeners.clear()
  }
}

export default LocalLivingRegistry
