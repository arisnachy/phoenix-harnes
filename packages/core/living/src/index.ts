/** Universal operational connection for artifacts and systems Phoenix creates. @module @phoenix-ai/dsh-living */

import { Context, Service } from '@phoenix-ai/cordis'
import type {
  LivingChangedListener, LivingCreationEventListener, LivingCreationId, LivingCreationManifest,
  LivingCreationProvider, LivingCreationSnapshot, LivingIntegrationLevel, LivingJson, LivingState,
} from './types.ts'

export type {
  LivingChangedListener, LivingCreationEvent, LivingCreationEventListener, LivingCreationManifest,
  LivingCreationProvider, LivingCreationSnapshot, LivingIntegrationLevel, LivingJson, LivingState,
} from './types.ts'

export type { LivingCreationId } from './types.ts'

/**
 * Construct a branded creation id after an owning boundary validates its text.
 * @param value - Stable textual identity supplied by the creation owner.
 * @returns The same value branded as a living-creation id.
 */
export function LivingCreationId(value: string): LivingCreationId {
  return value as LivingCreationId
}

const LEVELS: readonly LivingIntegrationLevel[] = ['static', 'connected', 'reactive', 'controllable', 'inhabited']

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
