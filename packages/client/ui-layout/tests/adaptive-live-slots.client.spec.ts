import { describe, expect, it } from 'vitest'
import { INSPECTABLE_SLOTS, inspectAdaptiveLiveSlots } from '../src/client/AdaptiveLiveSlots.ts'

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
