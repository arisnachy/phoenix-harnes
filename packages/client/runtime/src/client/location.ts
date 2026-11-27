/** Browser-owned geolocation sampling for ephemeral Reality Context provenance. */

export interface BrowserClientLocation {
  readonly latitude: number
  readonly longitude: number
  readonly accuracyMeters: number
  readonly observedAt: number
}

const CACHE_MAX_AGE_MS = 60_000
const GEOLOCATION_TIMEOUT_MS = 2_500
const RETRY_TIMEOUT_MS = 3_500
const FALLBACK_MAX_AGE_MS = 4 * 60_000

let cached: BrowserClientLocation | undefined
let inFlight: Promise<BrowserClientLocation | undefined> | undefined

function usableCached(now: number, maxAge = CACHE_MAX_AGE_MS): BrowserClientLocation | undefined {
  if (cached === undefined) return undefined
  if (cached.observedAt > now + 60_000) return undefined
  if (now - cached.observedAt > maxAge) return undefined
  return cached
}

async function permissionGranted(): Promise<boolean> {
  if (typeof navigator === 'undefined'
    || navigator.geolocation === undefined
    || navigator.permissions === undefined) return false
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' })
    return status.state === 'granted'
  } catch {
    // Some browser shells expose geolocation but not a queryable permission.
    // Do not call getCurrentPosition in that case because it could prompt.
    return false
  }
}

function samplePosition(highAccuracy: boolean, timeout: number, signal?: AbortSignal): Promise<BrowserClientLocation | undefined> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(undefined)
      return
    }
    let settled = false
    const finish = (value: BrowserClientLocation | undefined): void => {
      if (settled) return
      settled = true
      clearTimeout(watchdog)
      signal?.removeEventListener('abort', onAbort)
      resolve(value)
    }
    const onAbort = (): void => { finish(undefined) }
    const watchdog = setTimeout(() => finish(undefined), timeout + 100)
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords
          if (!Number.isFinite(latitude)
            || !Number.isFinite(longitude)
            || !Number.isFinite(accuracy)
            || latitude < -90
            || latitude > 90
            || longitude < -180
            || longitude > 180
            || accuracy <= 0) {
            finish(undefined)
            return
          }
          const timestamp = Math.round(position.timestamp)
          const now = Date.now()
          if (settled || !Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now + 60_000 || now - timestamp > CACHE_MAX_AGE_MS) {
            finish(undefined)
            return
          }
          const value: BrowserClientLocation = {
            latitude,
            longitude,
            accuracyMeters: accuracy,
            observedAt: timestamp,
          }
          cached = value
          finish(value)
        },
        () => { finish(undefined) },
        {
          enableHighAccuracy: highAccuracy,
          maximumAge: CACHE_MAX_AGE_MS,
          timeout,
        },
      )
    } catch {
      finish(undefined)
    }
  })
}

/**
 * Return a browser position only when geolocation permission is already
 * granted. Permission states "prompt" and "denied" both return undefined, so
 * sending a message never opens a surprise permission dialog.
  * @param signal - signal supplied to this public operation.
  * @returns Result produced by this public operation.
 */
export async function resolvedClientLocation(
  signal?: AbortSignal,
): Promise<BrowserClientLocation | undefined> {
  if (signal?.aborted) return undefined
  if (!(await permissionGranted())) {
    cached = undefined
    return undefined
  }
  if (signal?.aborted) return undefined
  const cachedValue = usableCached(Date.now())
  if (cachedValue !== undefined) return cachedValue
  if (inFlight === undefined) {
    // The shared probe is not cancelled by the first caller's abort signal.
    // Each caller independently decides whether it can consume the observation.
    const job = (async () => {
      let value = await samplePosition(false, GEOLOCATION_TIMEOUT_MS)
      if (value === undefined && await permissionGranted()) {
        value = await samplePosition(true, RETRY_TIMEOUT_MS)
      }
      if (!(await permissionGranted())) {
        cached = undefined
        return undefined
      }
      // Keep the original observation timestamp; never renew an old fix.
      return value ?? usableCached(Date.now(), FALLBACK_MAX_AGE_MS)
    })().finally(() => {
      if (inFlight === job) inFlight = undefined
    })
    inFlight = job
  }
  const value = await inFlight
  if (signal?.aborted) return undefined
  if (!(await permissionGranted())) {
    cached = undefined
    return undefined
  }
  return value
}
