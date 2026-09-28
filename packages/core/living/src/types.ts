import type { Branded } from '@phoenix-ai/dsh-brand'

export type LivingCreationId = Branded<'LivingCreationId'>
/** Achieved or requested integration depth for one Living creation. */
export type LivingIntegrationLevel = 'static' | 'connected' | 'reactive' | 'controllable' | 'inhabited'
/** JSON-safe value accepted by Living state, actions, and events. */
export type LivingJson = null | boolean | number | string | LivingJson[] | { [key: string]: LivingJson }
/** Named JSON-safe state fields exposed by a connected Living provider. */
export type LivingState = Record<string, LivingJson>

/** Durable contract describing one Phoenix-created Living artifact. */
export interface LivingCreationManifest {
  readonly id: LivingCreationId
  readonly title: string
  readonly kind: string
  readonly targetLevel: LivingIntegrationLevel
  readonly state: readonly string[]
  readonly actions: readonly string[]
  readonly events: readonly string[]
  readonly resources: readonly string[]
  readonly actors: readonly string[]
}

/** One named event emitted by a Living creation. */
export interface LivingCreationEvent {
  readonly creationId: LivingCreationId
  readonly name: string
  readonly data: LivingJson
}

/** Runtime provider implementing the live capabilities of one creation. */
export interface LivingCreationProvider {
  readonly readState?: () => LivingState | Promise<LivingState>
  readonly act?: (action: string, input: LivingJson) => LivingJson | Promise<LivingJson>
  readonly subscribe?: (emit: (name: string, data: LivingJson) => void) => (() => void)
  readonly actors?: readonly string[]
}

/** Read model combining a durable manifest with current connection depth. */
export interface LivingCreationSnapshot {
  readonly manifest: LivingCreationManifest
  readonly connected: boolean
  readonly achievedLevel: LivingIntegrationLevel
}

/** Listener notified when one creation's manifest or connectivity changes. */
export type LivingChangedListener = (creationId: LivingCreationId) => void
/** Listener receiving runtime events emitted by Living creations. */
export type LivingCreationEventListener = (event: LivingCreationEvent) => void
