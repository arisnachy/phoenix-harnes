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
    const observedAt = Date.now()
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
      })
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
  it('rejects expired observations rather than reporting them as current', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({ coords: { latitude: 19, longitude: -70, accuracy: 20 }, timestamp: Date.now() - 120_000 } as GeolocationPosition)
    })
    vi.stubGlobal('navigator', { permissions: { query: async () => ({ state: 'granted' }) }, geolocation: { getCurrentPosition } })
    const { resolvedClientLocation } = await import('../src/client/location.ts')
    await expect(resolvedClientLocation()).resolves.toBeUndefined()
  })

  it('does not return a cached location after permission is revoked', async () => {
    let state = 'granted'
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({ coords: { latitude: 19, longitude: -70, accuracy: 20 }, timestamp: Date.now() } as GeolocationPosition)
    })
    vi.stubGlobal('navigator', { permissions: { query: async () => ({ state }) }, geolocation: { getCurrentPosition } })
    const { resolvedClientLocation } = await import('../src/client/location.ts')
    await expect(resolvedClientLocation()).resolves.toBeDefined()
    state = 'denied'
    await expect(resolvedClientLocation()).resolves.toBeUndefined()
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
  })
})
