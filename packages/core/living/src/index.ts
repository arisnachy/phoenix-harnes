/** Universal operational connection for artifacts and systems Phoenix creates. @module @phoenix-ai/dsh-living */

import { Context, Service } from '@phoenix-ai/cordis'
import type {
  LivingChangedListener, LivingCreationEventListener, LivingCreationId as LivingCreationIdType, LivingCreationManifest,
  LivingCreationProvider, LivingCreationSnapshot, LivingIntegrationLevel, LivingJson, LivingState,
} from './types.ts'

export type {
  LivingChangedListener, LivingCreationEvent, LivingCreationEventListener, LivingCreationManifest,
  LivingCreationProvider, LivingCreationSnapshot, LivingIntegrationLevel, LivingJson, LivingState,
} from './types.ts'

export type LivingCreationId = LivingCreationIdType

/**
 * Construct a branded creation id after an owning boundary validates its text.
 * @param value - Stable textual identity supplied by the creation owner.
 * @returns The same value branded as a living-creation id.
 */
export function LivingCreationId(value: string): LivingCreationId {
  return value as LivingCreationId
}

const LEVELS: readonly LivingIntegrationLevel[] = ['static', 'connected', 'reactive', 'controllable', 'inhabited']


export const LIVING_CONTROL_PROTOCOL = 'phoenix-living-http-v1' as const
export const DEFAULT_LIVING_CONTROL_HOST = '127.0.0.1'
export const DEFAULT_LIVING_CONTROL_PORT = 32145

export interface LivingControlDescriptor {
  readonly protocol: typeof LIVING_CONTROL_PROTOCOL
  readonly endpoint: string
  readonly token: string
}

function livingControlPort(): number {
  const raw = process.env.PHOENIX_LIVING_CONTROL_PORT?.trim()
  if (raw === undefined || raw.length === 0) return DEFAULT_LIVING_CONTROL_PORT
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`PHOENIX_LIVING_CONTROL_PORT must be an integer from 1 to 65535, got ${JSON.stringify(raw)}`)
  }
  return value
}

/**
 * Default owner-local endpoint used by the built-in living control bridge.
 * Deployments can override host/port through PHOENIX_LIVING_CONTROL_HOST/PORT.
 */
export function defaultLivingControlEndpoint(): string {
  const host = process.env.PHOENIX_LIVING_CONTROL_HOST?.trim() || DEFAULT_LIVING_CONTROL_HOST
  return `http://${host}:${livingControlPort()}/v1/living`
}

/** Encode one scoped connector descriptor into the manifest's domain-neutral resources list. */
export function createLivingControlResource(endpoint: string, token: string): string {
  const target = new URL(endpoint)
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new TypeError(`living control endpoint must be http(s), got ${target.protocol}`)
  }
  if (token.length < 24 || token !== token.trim()) {
    throw new TypeError('living control token must be a normalized high-entropy secret')
  }
  const resource = new URL('phoenix-control://v1')
  resource.searchParams.set('endpoint', target.toString().replace(/\/$/, ''))
  resource.searchParams.set('token', token)
  return resource.toString()
}

/** Parse one Phoenix control resource; unrelated resources return undefined. */
export function parseLivingControlResource(resource: string): LivingControlDescriptor | undefined {
  let parsed: URL
  try {
    parsed = new URL(resource)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'phoenix-control:' || parsed.hostname !== 'v1') return undefined
  const endpoint = parsed.searchParams.get('endpoint')
  const token = parsed.searchParams.get('token')
  if (endpoint === null || token === null) throw new TypeError('invalid phoenix-control resource: endpoint and token are required')
  const target = new URL(endpoint)
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new TypeError(`living control endpoint must be http(s), got ${target.protocol}`)
  }
  if (token.length < 24 || token !== token.trim()) {
    throw new TypeError('living control token must be a normalized high-entropy secret')
  }
  return { protocol: LIVING_CONTROL_PROTOCOL, endpoint: target.toString().replace(/\/$/, ''), token }
}

/** Return the single scoped control link carried by a creation manifest, if any. */
export function livingControlForManifest(manifest: LivingCreationManifest): LivingControlDescriptor | undefined {
  let found: LivingControlDescriptor | undefined
  for (const resource of manifest.resources) {
    const parsed = parseLivingControlResource(resource)
    if (parsed === undefined) continue
    if (found !== undefined) throw new TypeError(`living creation ${manifest.id} declares more than one phoenix-control resource`)
    found = parsed
  }
  return found
}

/**
 * Numeric ordering used to compare achieved and requested integration levels.
 * @param level - Integration level to rank.
 * @returns Zero-based rank from static through inhabited.
 */
export function livingLevelRank(level: LivingIntegrationLevel): number {
  return LEVELS.indexOf(level)
}

function uniqueNormalized(label: string, values: readonly string[]): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (value.length === 0 || value !== value.trim()) throw new TypeError(`${label} entries must be non-empty normalized strings`)
    if (seen.has(value)) throw new TypeError(`${label} contains duplicate entry ${JSON.stringify(value)}`)
    seen.add(value)
  }
}

/**
 * Validate one domain-neutral manifest without interpreting its `kind`.
 * @param manifest - Self-described creation capabilities and target level.
 */
export function validateLivingManifest(manifest: LivingCreationManifest): void {
  if (manifest.id.length === 0 || manifest.id !== manifest.id.trim()) throw new TypeError('living creation id must be a non-empty normalized string')
  if (manifest.title.length === 0 || manifest.title !== manifest.title.trim()) throw new TypeError('living creation title must be a non-empty normalized string')
  if (manifest.kind.length === 0 || manifest.kind !== manifest.kind.trim()) throw new TypeError('living creation kind must be a non-empty normalized string')
  if (!LEVELS.includes(manifest.targetLevel)) throw new TypeError(`unknown living integration level ${JSON.stringify(manifest.targetLevel)}`)
  uniqueNormalized('state', manifest.state)
  uniqueNormalized('actions', manifest.actions)
  uniqueNormalized('events', manifest.events)
  uniqueNormalized('resources', manifest.resources)
  uniqueNormalized('actors', manifest.actors)
  const rank = livingLevelRank(manifest.targetLevel)
  if (rank >= livingLevelRank('connected') && manifest.state.length === 0) throw new TypeError(`${manifest.targetLevel} living creation must declare observable state`)
  if (rank >= livingLevelRank('reactive') && manifest.events.length === 0) throw new TypeError(`${manifest.targetLevel} living creation must declare at least one event`)
  if (rank >= livingLevelRank('controllable') && manifest.actions.length === 0) throw new TypeError(`${manifest.targetLevel} living creation must declare at least one action`)
  if (rank >= livingLevelRank('inhabited') && manifest.actors.length === 0) throw new TypeError('inhabited living creation must declare at least one actor')
}

/**
 * Resolve the highest integration level a concrete provider proves at runtime.
 * @param provider - Runtime methods and actors supplied by one creation.
 * @returns Highest level justified by the provider's actual capabilities.
 */
export function livingProviderLevel(provider: LivingCreationProvider): LivingIntegrationLevel {
  if (provider.readState === undefined) return 'static'
  if (provider.subscribe === undefined) return 'connected'
  if (provider.act === undefined) return 'reactive'
  if (provider.actors === undefined || provider.actors.length === 0) return 'controllable'
  return 'inhabited'
}

declare module '@phoenix-ai/cordis' {
  interface Context {
    living: LivingRegistry
  }
}

/**
 * Service Definition for every creation Phoenix keeps operationally connected.
 * Implementations persist manifests separately from ephemeral provider attachments.
 */
export abstract class LivingRegistry extends Service {
  constructor(ctx: Context) {
    if (new.target === LivingRegistry) throw new Error('@phoenix-ai/dsh-living is a Service Definition; load a provider such as @phoenix-ai/dsh-living-local')
    super(ctx, 'living')
  }

  /**
   * Resolve the endpoint generated runtimes should use for the universal control transport.
   * Providers with dynamic binding may override this; the default follows Phoenix's host/port environment.
   * @returns Fully qualified base endpoint for living runtime control.
   */
  controlEndpoint(): Promise<string> {
    return Promise.resolve(defaultLivingControlEndpoint())
  }

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
}

export default LivingRegistry
