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

  it('allows the browser consent dialog only on an explicit location request', async () => {
    let state = 'prompt'
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      state = 'granted'
      success({ coords: { latitude: 19, longitude: -70, accuracy: 25 }, timestamp: Date.now() } as GeolocationPosition)
    })
    vi.stubGlobal('navigator', { permissions: { query: async () => ({ state }) }, geolocation: { getCurrentPosition } })
    const { resolvedClientLocation, isExplicitLocationRequest } = await import('../src/client/location.ts')
    expect(isExplicitLocationRequest('¿Y dónde estamos ubicado?')).toBe(true)
    expect(isExplicitLocationRequest('Kira, ¿dónde estamos?')).toBe(true)
    expect(isExplicitLocationRequest('Where am I?')).toBe(true)
    expect(isExplicitLocationRequest('Traduce dónde estamos')).toBe(false)
    expect(isExplicitLocationRequest('¿Dónde está Madrid?')).toBe(false)
    expect(isExplicitLocationRequest('El usuario preguntó dónde estamos')).toBe(false)
    await expect(resolvedClientLocation(undefined, true)).resolves.toMatchObject({ latitude: 19, longitude: -70 })
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    state = 'denied'
    await expect(resolvedClientLocation(undefined, true)).resolves.toBeUndefined()
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
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
