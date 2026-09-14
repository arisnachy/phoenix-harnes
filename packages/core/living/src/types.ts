import type { Branded } from '@phoenix-ai/dsh-brand'

export type LivingCreationId = Branded<'LivingCreationId'>
export type LivingIntegrationLevel = 'static' | 'connected' | 'reactive' | 'controllable' | 'inhabited'
export type LivingJson = null | boolean | number | string | LivingJson[] | { [key: string]: LivingJson }
export type LivingState = Record<string, LivingJson>

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

export interface LivingCreationEvent {
  readonly creationId: LivingCreationId
  readonly name: string
  readonly data: LivingJson
}

export interface LivingCreationProvider {
  readonly readState?: () => LivingState | Promise<LivingState>
  readonly act?: (action: string, input: LivingJson) => LivingJson | Promise<LivingJson>
  readonly subscribe?: (emit: (name: string, data: LivingJson) => void) => (() => void)
  readonly actors?: readonly string[]
}

export interface LivingCreationSnapshot {
  readonly manifest: LivingCreationManifest
  readonly connected: boolean
  readonly achievedLevel: LivingIntegrationLevel
}

export type LivingChangedListener = (creationId: LivingCreationId) => void
export type LivingCreationEventListener = (event: LivingCreationEvent) => void
