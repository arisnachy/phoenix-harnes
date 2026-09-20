import { afterEach, describe, expect, it, vi } from 'vitest'

describe('resolvedClientLocation', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not invoke geolocation when permission would prompt', async () => {
    const getCurrentPosition = vi.fn()
    vi.stubGlobal('navigator', {
      permissions: { query: vi.fn(async () => ({ state: 'prompt' })) },
      geolocation: { getCurrentPosition },
    })

    const { resolvedClientLocation } = await import('../src/client/location.ts')
    await expect(resolvedClientLocation()).resolves.toBeUndefined()
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('returns a bounded browser observation when permission is already granted', async () => {
    const observedAt = Date.parse('2026-09-20T18:00:00.000Z')
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: {
          latitude: 19.451,
          longitude: -70.697,
          accuracy: 22,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          toJSON() { return {} },
        },
        timestamp: observedAt,
        toJSON() { return {} },
      } as GeolocationPosition)
    })
    vi.stubGlobal('navigator', {
      permissions: { query: vi.fn(async () => ({ state: 'granted' })) },
      geolocation: { getCurrentPosition },
    })

    const { resolvedClientLocation } = await import('../src/client/location.ts')
    await expect(resolvedClientLocation()).resolves.toEqual({
      latitude: 19.451,
      longitude: -70.697,
      accuracyMeters: 22,
      observedAt,
    })
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
  })
})
