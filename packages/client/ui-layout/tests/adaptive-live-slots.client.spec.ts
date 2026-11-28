import { describe, expect, it } from 'vitest'
import { LIVING_PRESENCE_ENABLED, INSPECTABLE_SLOTS, inspectAdaptiveLiveSlots, livingNeedsCompactSidebar, livingSeason } from '../src/client/AdaptiveLiveSlots.ts'

describe('Adaptive OS live UI self-inspection', () => {
  it('observes only an allowlisted slot roster without escalating privileges', () => {
    const snapshot = inspectAdaptiveLiveSlots(name => name === 'conversation' ? 1 : 0, 12345)
    expect(snapshot.schema).toBe('phoenix.adaptive.live-ui.v1')
    expect(snapshot.trust).toBe('presentation-only')
    expect(snapshot.privilegesGranted).toBe(false)
    expect(snapshot.observedAt).toBe(12345)
    expect(snapshot.slots).toHaveLength(INSPECTABLE_SLOTS.length)
    expect(snapshot.slots.find(s => s.id === 'conversation')?.state).toBe('registered')
    expect(snapshot.slots.find(s => s.id === 'sidebar')?.state).toBe('unavailable')
    expect(JSON.stringify(snapshot)).not.toMatch(/apiKey|password|patientName/u)
  })
  it('treats malformed counts as unavailable', () => {
    const snapshot = inspectAdaptiveLiveSlots(() => Number.POSITIVE_INFINITY)
    expect(snapshot.slots.every(s => s.registrations === 0)).toBe(true)
  })
})

describe('Living presence reversible local presentation', () => {
  it('is permanently active independent of browser preferences', () => {
    expect(LIVING_PRESENCE_ENABLED).toBe(true)
    expect(livingSeason(new Date(2026, 11, 25), LIVING_PRESENCE_ENABLED)).toBe('christmas')
  })
  it('decorates only an enabled local holiday window and restores automatically', () => {
    expect(livingSeason(new Date(2026, 11, 1), true)).toBe('christmas')
    expect(livingSeason(new Date(2027, 0, 6), true)).toBe('christmas')
    expect(livingSeason(new Date(2027, 0, 7), true)).toBe('none')
    expect(livingSeason(new Date(2026, 11, 25), false)).toBe('none')
    expect(livingSeason(new Date(NaN), true)).toBe('none')
  })
  it('borrows width only from a real constrained layout and respects ownership', () => {
    const input = { enabled: true, viewport: 1280, sidebar: 320, details: 360, visualWork: false, cordisOwnsLayout: false }
    expect(livingNeedsCompactSidebar(input)).toBe(true)
    expect(livingNeedsCompactSidebar({ ...input, viewport: 1600 })).toBe(false)
    expect(livingNeedsCompactSidebar({ ...input, enabled: false })).toBe(false)
    expect(livingNeedsCompactSidebar({ ...input, cordisOwnsLayout: true })).toBe(false)
    expect(livingNeedsCompactSidebar({ ...input, sidebar: 0 })).toBe(false)
    expect(livingNeedsCompactSidebar({ ...input, viewport: NaN })).toBe(false)
    expect(livingNeedsCompactSidebar({ ...input, viewport: 1150, details: 0, visualWork: true })).toBe(true)
    expect(livingNeedsCompactSidebar({ ...input, viewport: 1150, details: 0 })).toBe(false)
    // Normal chat also adapts when a manually enlarged rail consumes the center floor.
    expect(livingNeedsCompactSidebar({ ...input, viewport: 1040, sidebar: 420, details: 0 })).toBe(true)
    expect(livingNeedsCompactSidebar({ ...input, viewport: 1100, sidebar: 420, details: 0 })).toBe(false)
  })
})
