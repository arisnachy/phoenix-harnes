/** Durable process-local provider for `ctx.living`. @module @phoenix-ai/dsh-living-local */

import { readFileSync } from 'node:fs'
import { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import { writeFileAtomic } from '@phoenix-ai/dsh-atomic-write'
import {
  LivingRegistry, livingLevelRank, livingProviderLevel, validateLivingManifest,
} from '@phoenix-ai/dsh-living'
import type {
  LivingChangedListener, LivingCreationEventListener, LivingCreationId, LivingCreationManifest,
  LivingCreationProvider, LivingCreationSnapshot, LivingJson, LivingState,
} from '@phoenix-ai/dsh-living'

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

/** Process-local registry with durable manifest identity and ephemeral live providers. */
export class LocalLivingRegistry extends LivingRegistry {
  static Config: z<Config> = z.object({ path: z.string().required() })

  private manifests: Map<LivingCreationId, LivingCreationManifest>
  private readonly providers = new Map<LivingCreationId, AttachedProvider>()
  private readonly changed = new Set<LivingChangedListener>()
  private readonly eventListeners = new Set<LivingCreationEventListener>()
  private writeChain: Promise<void> = Promise.resolve()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
    if (config.path.length === 0 || config.path !== config.path.trim()) throw new TypeError('living-local path must be a non-empty normalized string')
    this.manifests = readDocument(config.path)
    ctx.effect(() => () => this.disposeProviders(), 'living provider teardown')
  }

  async remember(manifest: LivingCreationManifest): Promise<LivingCreationSnapshot> {
    validateLivingManifest(manifest)
    const next = new Map(this.manifests)
    next.set(manifest.id, clone(manifest))
    await this.persist(next)
    this.manifests = next
    this.notifyChanged(manifest.id)
    return this.inspect(manifest.id)
  }

  async forget(id: LivingCreationId): Promise<void> {
    this.requireManifest(id)
    const attached = this.providers.get(id)
    attached?.disposeSubscription()
    this.providers.delete(id)
    const next = new Map(this.manifests)
    next.delete(id)
    await this.persist(next)
    this.manifests = next
    this.notifyChanged(id)
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
    const achieved = livingProviderLevel(provider)
    if (livingLevelRank(achieved) < livingLevelRank(manifest.targetLevel)) {
      throw new Error(`living provider for ${id} achieves ${achieved}, below target ${manifest.targetLevel}`)
    }
    if (manifest.targetLevel === 'inhabited') {
      const actorSet = new Set(provider.actors ?? [])
      const missing = manifest.actors.filter(actor => !actorSet.has(actor))
      if (missing.length > 0) throw new Error(`living provider for ${id} is missing declared actors: ${missing.join(', ')}`)
    }
    let active = true
    const emit = (name: string, data: LivingJson): void => {
      if (!active) return
      if (!manifest.events.includes(name)) throw new Error(`living creation ${id} emitted undeclared event ${JSON.stringify(name)}`)
      const event = { creationId: id, name, data: clone(data) }
      for (const listener of [...this.eventListeners]) {
        try { listener(event) } catch { /* observers cannot break the creation */ }
      }
    }
    const record: AttachedProvider = { provider, disposeSubscription: () => undefined }
    this.providers.set(id, record)
    try {
      const disposeSubscription = provider.subscribe?.(emit) ?? (() => undefined)
      this.providers.set(id, { provider, disposeSubscription })
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
      active = false
      const current = this.providers.get(id)
      if (current?.provider !== provider) return
      current.disposeSubscription()
      this.providers.delete(id)
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

  private notifyChanged(id: LivingCreationId): void {
    for (const listener of [...this.changed]) {
      try { listener(id) } catch { /* registry observers are isolated */ }
    }
  }

  private persist(next: Map<LivingCreationId, LivingCreationManifest>): Promise<void> {
    const document: PersistedDocument = { version: 1, creations: [...next.values()].map(clone) }
    const content = `${JSON.stringify(document, null, 2)}\n`
    const write = this.writeChain.then(() => writeFileAtomic(this.config.path, content, { mode: 0o600, dirMode: 0o700 }))
    this.writeChain = write.catch(() => undefined)
    return write
  }

  private disposeProviders(): void {
    for (const attached of this.providers.values()) attached.disposeSubscription()
    this.providers.clear()
    this.changed.clear()
    this.eventListeners.clear()
  }
}

export default LocalLivingRegistry
