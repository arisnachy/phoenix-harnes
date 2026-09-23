import type { Branded } from '@phoenix-ai/dsh-brand'

/**
 * Public living creation id shape.
 */
export type LivingCreationId = Branded<'LivingCreationId'>
/**
 * Public living integration level shape.
 */
export type LivingIntegrationLevel = 'static' | 'connected' | 'reactive' | 'controllable' | 'inhabited'
/**
 * Public living json shape.
 */
export type LivingJson = null | boolean | number | string | LivingJson[] | { [key: string]: LivingJson }
/**
 * Public living state shape.
 */
export type LivingState = Record<string, LivingJson>

/**
 * Public living creation manifest shape.
 */
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

/**
 * Public living creation event shape.
 */
export interface LivingCreationEvent {
  readonly creationId: LivingCreationId
  readonly name: string
  readonly data: LivingJson
}

/**
 * Public living creation provider shape.
 */
export interface LivingCreationProvider {
  readonly readState?: () => LivingState | Promise<LivingState>
  readonly act?: (action: string, input: LivingJson) => LivingJson | Promise<LivingJson>
  readonly subscribe?: (emit: (name: string, data: LivingJson) => void) => (() => void)
  readonly actors?: readonly string[]
}

/**
 * Public living creation snapshot shape.
 */
export interface LivingCreationSnapshot {
  readonly manifest: LivingCreationManifest
  readonly connected: boolean
  readonly achievedLevel: LivingIntegrationLevel
}

/**
 * Public living changed listener shape.
 */
export type LivingChangedListener = (creationId: LivingCreationId) => void
/**
 * Public living creation event listener shape.
 */
export type LivingCreationEventListener = (event: LivingCreationEvent) => void
