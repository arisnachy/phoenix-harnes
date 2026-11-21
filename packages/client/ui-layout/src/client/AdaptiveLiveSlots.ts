/**
 * PHOENIX OS: bounded live UI own-state snapshot from the registered slot system.
 * Slot presence is evidence of an active renderer registration, NOT proof of
 * backend connectivity, clinical authorization, device access or model ability.
 */
export const INSPECTABLE_SLOTS = [
  'sidebar', 'conversation', 'details', 'shell.overlay', 'shell.workspace',
  'conversation.composer.bar', 'conversation.view',
] as const
export type InspectableSlot = (typeof INSPECTABLE_SLOTS)[number]

export interface AdaptiveLiveSlot {
  readonly id: InspectableSlot
  readonly registrations: number
  readonly state: 'registered' | 'unavailable'
}
export interface AdaptiveLiveSnapshot {
  readonly schema: 'phoenix.adaptive.live-ui.v1'
  readonly observedAt: number
  readonly trust: 'presentation-only'
  readonly privilegesGranted: false
  readonly slots: readonly AdaptiveLiveSlot[]
}
export function inspectAdaptiveLiveSlots(
  count: (id: InspectableSlot) => number,
  observedAt = Date.now(),
): AdaptiveLiveSnapshot {
  const slots = INSPECTABLE_SLOTS.map(id => {
    const value = count(id)
    const registrations = Number.isSafeInteger(value) && value >= 0 && value <= 1000 ? value : 0
    return {
      id, registrations, state: registrations > 0 ? 'registered' as const : 'unavailable' as const,
    }
  })
  return {
    schema: 'phoenix.adaptive.live-ui.v1',
    observedAt, trust: 'presentation-only',
    privilegesGranted: false,
    slots,
  }
}
