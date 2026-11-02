import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import { ClientRealityService } from '../src/client-reality.ts'

describe('ClientRealityService', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps browser coordinates ephemeral and expires them after five minutes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-20T18:00:00.000Z'))
    const service = new ClientRealityService(new Context())
    const sessionId = 'session-a' as never
    const observedAt = Date.now()

    service.observeLocation(sessionId, {
      latitude: 19.451,
      longitude: -70.697,
      accuracyMeters: 25,
      observedAt,
    })

    expect(service.locationFor(sessionId)).toMatchObject({
      latitude: 19.451,
      longitude: -70.697,
      accuracyMeters: 25,
      observedAt,
      source: 'browser-geolocation',
    })

    vi.advanceTimersByTime(5 * 60_000 + 1)
    expect(service.locationFor(sessionId)).toBeUndefined()
  })

  it('rejects stale, future-skewed, and less-accurate duplicate observations', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-20T18:00:00.000Z'))
    const service = new ClientRealityService(new Context())
    const sessionId = 'session-b' as never
    const now = Date.now()

    service.observeLocation(sessionId, {
      latitude: 19,
      longitude: -70,
      accuracyMeters: 10,
      observedAt: now - 16 * 60_000,
    })
    service.observeLocation(sessionId, {
      latitude: 19,
      longitude: -70,
      accuracyMeters: 10,
      observedAt: now + 61_000,
    })
    expect(service.locationFor(sessionId)).toBeUndefined()

    service.observeLocation(sessionId, {
      latitude: 19.45,
      longitude: -70.69,
      accuracyMeters: 15,
      observedAt: now,
    })
    service.observeLocation(sessionId, {
      latitude: 19.46,
      longitude: -70.68,
      accuracyMeters: 50,
      observedAt: now,
    })
    expect(service.locationFor(sessionId)).toMatchObject({
      latitude: 19.45,
      longitude: -70.69,
      accuracyMeters: 15,
    })
  })
})
