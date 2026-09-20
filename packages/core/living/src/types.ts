import type { Branded } from '@phoenix-ai/dsh-brand'

/** Stable opaque identity for one Phoenix-remembered creation. */
export type LivingCreationId = Branded<'LivingCreationId'>
/** Ordered operational integration level achieved or targeted by a creation. */
export type LivingIntegrationLevel = 'static' | 'connected' | 'reactive' | 'controllable' | 'inhabited'
/** JSON-compatible value accepted by the Living capability. */
export type LivingJson = null | boolean | number | string | LivingJson[] | { [key: string]: LivingJson }
/** Authoritative live state projected by a connected creation provider. */
export type LivingState = Record<string, LivingJson>

/** Durable self-description of a creation and the capabilities Phoenix should preserve. */
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

/** One declared event emitted by a connected creation. */
export interface LivingCreationEvent {
  readonly creationId: LivingCreationId
  readonly name: string
  readonly data: LivingJson
}

/** Ephemeral live authority attached to a remembered creation. */
export interface LivingCreationProvider {
  readonly readState?: () => LivingState | Promise<LivingState>
  readonly act?: (action: string, input: LivingJson) => LivingJson | Promise<LivingJson>
  readonly subscribe?: (emit: (name: string, data: LivingJson) => void) => (() => void)
  readonly actors?: readonly string[]
}

/** Current durable manifest plus observed live integration status. */
export interface LivingCreationSnapshot {
  readonly manifest: LivingCreationManifest
  readonly connected: boolean
  readonly achievedLevel: LivingIntegrationLevel
}

/** Listener notified when one creation's registry or connectivity state changes. */
export type LivingChangedListener = (creationId: LivingCreationId) => void
/** Listener receiving declared events from connected creations. */
export type LivingCreationEventListener = (event: LivingCreationEvent) => void
