import { describe, expect, it } from 'vitest'
import {
  RealityContextEngine,
  realityConfigFromEnvironment,
} from '../src/reality-context.ts'

describe('Phoenix reality context', () => {
  it('does not accept partial or invalid coordinates as precise location', () => {
    expect(realityConfigFromEnvironment({
      PHOENIX_REALITY_LATITUDE: '19.45',
    })).not.toHaveProperty('latitude')

    expect(realityConfigFromEnvironment({
      PHOENIX_REALITY_LATITUDE: '999',
      PHOENIX_REALITY_LONGITUDE: '-70.7',
    })).not.toHaveProperty('latitude')
  })

  it('projects wall clock, UTC, timezone, monotonic time, device, runtime, and explicit unknowns', () => {
    const engine = new RealityContextEngine({ refreshMs: 30_000 })
    const fakeContext = {
      get(name: string) {
        return name === 'tools' || name === 'authorization' ? {} : undefined
      },
    } as never
    const snapshot = engine.snapshot(fakeContext, new Date('2026-09-20T13:58:00.000Z'))

    expect(snapshot.schema).toBe(1)
    expect(snapshot.time).toHaveProperty('wallClockUtc', '2026-09-20T13:58:00.000Z')
    expect(snapshot.time).toHaveProperty('monotonicMilliseconds')
    expect(snapshot.time).toHaveProperty('timezone')
    expect(snapshot.location).toMatchObject({ status: 'unknown' })
    expect(snapshot.weather).toMatchObject({ status: 'unknown' })
    expect(snapshot.capabilities).toMatchObject({
      activeServices: ['tools', 'authorization'],
    })
    expect(snapshot.authentication).toMatchObject({
      status: 'requires-live-connector-check',
      authorizationServiceAvailable: true,
    })
  })

  it('marks configured coordinates as explicitly authorized/configured without inferring accuracy', () => {
    const engine = new RealityContextEngine({
      refreshMs: 30_000,
      latitude: 19.45,
      longitude: -70.70,
      locationLabel: 'configured test location',
    })
    const snapshot = engine.snapshot({ get() { return undefined } } as never)
    expect(snapshot.location).toMatchObject({
      status: 'authorized-configured',
      latitude: 19.45,
      longitude: -70.70,
      accuracyMeters: null,
      source: 'explicit PHOENIX_REALITY_* configuration',
    })
  })

  it('renders a model-facing reality envelope that forbids treating unknowns as facts', () => {
    const engine = new RealityContextEngine({ refreshMs: 30_000 })
    const rendered = engine.render({ get() { return undefined } } as never)
    expect(rendered).toContain('<phoenix_reality_context>')
    expect(rendered).toContain('Treat stale/unknown fields as unavailable')
  })
})
