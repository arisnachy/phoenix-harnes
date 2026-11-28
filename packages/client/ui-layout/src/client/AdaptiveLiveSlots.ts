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

/** Permanent local presentation capability; no model or connector grants are created. */
export const LIVING_PRESENCE_ENABLED = true as const
export type LivingSeason = 'christmas' | 'none'

/** Respect the local calendar, without polling a model or a network service. */
export function livingSeason(now: Date, enabled: boolean): LivingSeason {
  if (!enabled || !Number.isFinite(now.getTime())) return 'none'
  const month = now.getMonth()
  const day = now.getDate()
  return month === 11 || (month === 0 && day <= 6) ? 'christmas' : 'none'
}

/** Determine whether the real available geometry warrants a compact sidebar.
 * This is a transient presentation decision; no preferred widths are rewritten.
 * @param input - Current frame geometry and existing layout ownership.
 * @returns Whether the adaptive layer may borrow the navigation width.
 */
export function livingNeedsCompactSidebar(input: {
  enabled: boolean; viewport: number; sidebar: number; details: number
  visualWork: boolean; cordisOwnsLayout: boolean
}): boolean {
  const { enabled, viewport, sidebar, details, visualWork, cordisOwnsLayout } = input
  if (!enabled || cordisOwnsLayout || sidebar <= 72
    || ![viewport, sidebar, details].every(Number.isFinite)
    || viewport <= 0 || details < 0) return false
  const target = visualWork ? 900 : 640
  return viewport - sidebar - details < target
}

/** Bounded presentation metadata for the existing sidebar and self-inspection. */
export interface LivingPresenceSnapshot {
  readonly enabled: boolean
  readonly season: LivingSeason
  readonly compacted: boolean
  readonly recoveredPixels: number
  readonly notice: 'workspace-compacted' | 'christmas' | 'ready' | 'disabled'
  /** Resolved frame widths, never settings values, user content or privileges. */
  readonly geometry?: { readonly viewport: number; readonly sidebar: number; readonly center: number; readonly details: number; readonly visualWork: boolean; readonly manualExpansion: boolean }
}
