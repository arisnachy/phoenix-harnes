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
  it('retries a failed coarse fix with high accuracy and retains the real observation time', async () => {
    const observedAt = Date.now()
    const getCurrentPosition = vi.fn()
      .mockImplementationOnce((_success: PositionCallback, failure: PositionErrorCallback) => failure({ code: 2 } as GeolocationPositionError))
      .mockImplementationOnce((success: PositionCallback) => success({ coords: { latitude: 19, longitude: -70, accuracy: 15 }, timestamp: observedAt } as GeolocationPosition))
    vi.stubGlobal('navigator', {
      permissions: { query: async () => ({ state: 'granted' }) },
      geolocation: { getCurrentPosition },
    })
    const { resolvedClientLocation } = await import('../src/client/location.ts')
    await expect(resolvedClientLocation()).resolves.toMatchObject({ observedAt, accuracyMeters: 15 })
    expect(getCurrentPosition.mock.calls[0]?.[2]).toMatchObject({ enableHighAccuracy: false })
    expect(getCurrentPosition.mock.calls[1]?.[2]).toMatchObject({ enableHighAccuracy: true })
  })

  it('retains a recent previously validated fix without renewing its timestamp on transient failure', async () => {
    const observedAt = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(observedAt)
    const getCurrentPosition = vi.fn()
      .mockImplementationOnce((success: PositionCallback) => success({ coords: { latitude: 19, longitude: -70, accuracy: 20 }, timestamp: observedAt } as GeolocationPosition))
      .mockImplementation((_success: PositionCallback, failure: PositionErrorCallback) => failure({ code: 2 } as GeolocationPositionError))
    vi.stubGlobal('navigator', {
      permissions: { query: async () => ({ state: 'granted' }) },
      geolocation: { getCurrentPosition },
    })
    const { resolvedClientLocation } = await import('../src/client/location.ts')
    await expect(resolvedClientLocation()).resolves.toMatchObject({ observedAt })
    clock.mockReturnValue(observedAt + 120_000)
    await expect(resolvedClientLocation()).resolves.toMatchObject({ observedAt })
    clock.mockReturnValue(observedAt + 241_000)
    await expect(resolvedClientLocation()).resolves.toBeUndefined()
  })
  it('publishes granted observations without a message and clears after permission loss', async () => {
    let state = 'granted'
    const observedAt = Date.now()
    vi.stubGlobal('navigator', {
      permissions: { query: async () => ({ state }) },
      geolocation: { getCurrentPosition: (success: PositionCallback) =>
        success({ coords: { latitude: 10, longitude: 20, accuracy: 25 }, timestamp: observedAt } as GeolocationPosition) },
    })
    const { startClientLocationMonitor } = await import('../src/client/location.ts')
    const publish = vi.fn(async () => true)
    const monitor = startClientLocationMonitor(() => 'session-a', publish)
    try {
      await monitor.refresh()
      expect(publish).toHaveBeenCalledWith('session-a', expect.objectContaining({ observedAt }), expect.anything())
      await monitor.refresh()
      expect(publish).toHaveBeenCalledTimes(1)
      state = 'denied'
      await monitor.refresh()
      expect(publish).toHaveBeenLastCalledWith('session-a', null, expect.anything())
    } finally { monitor.dispose() }
  })
})
