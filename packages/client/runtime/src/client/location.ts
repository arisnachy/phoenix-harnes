/** Browser-owned geolocation sampling for ephemeral Reality Context provenance. */

export interface BrowserClientLocation {
  readonly latitude: number
  readonly longitude: number
  readonly accuracyMeters: number
  readonly observedAt: number
}

const CACHE_MAX_AGE_MS = 60_000
const GEOLOCATION_TIMEOUT_MS = 1_200

let cached: BrowserClientLocation | undefined
let inFlight: Promise<BrowserClientLocation | undefined> | undefined

function usableCached(now: number): BrowserClientLocation | undefined {
  if (cached === undefined) return undefined
  if (cached.observedAt > now + 60_000) return undefined
  if (now - cached.observedAt > CACHE_MAX_AGE_MS) return undefined
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

function samplePosition(signal?: AbortSignal): Promise<BrowserClientLocation | undefined> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(undefined)
      return
    }
    let settled = false
    const finish = (value: BrowserClientLocation | undefined): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      resolve(value)
    }
    const onAbort = (): void => { finish(undefined) }
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
          const timestamp = Number.isFinite(position.timestamp) && position.timestamp > 0
            ? Math.round(position.timestamp)
            : Date.now()
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
          enableHighAccuracy: false,
          maximumAge: CACHE_MAX_AGE_MS,
          timeout: GEOLOCATION_TIMEOUT_MS,
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
  const now = Date.now()
  const cachedValue = usableCached(now)
  if (cachedValue !== undefined) return cachedValue
  if (!(await permissionGranted())) return undefined
  if (signal?.aborted) return undefined
  if (inFlight !== undefined) return inFlight
  const job = samplePosition(signal).finally(() => {
    if (inFlight === job) inFlight = undefined
  })
  inFlight = job
  return job
}

/**
 * Best-effort browser position for chat submission.
 *
 * Location is optional provenance, never a prerequisite for accepting the
 * user's message. Some browsers leave Permissions.query() pending indefinitely
 * despite a bounded getCurrentPosition timeout. Let the observation continue
 * in the background, but release the admission path after a short budget.
 * A late, permission-approved observation warms the normal 60-second cache.
 */
export function resolvedPromptClientLocation(
  signal?: AbortSignal,
): Promise<BrowserClientLocation | undefined> {
  const existing = usableCached(Date.now())
  if (existing !== undefined || signal?.aborted) return Promise.resolve(existing)
  const budgetMs = 75
  return new Promise((resolve) => {
    let finished = false
    const finish = (value: BrowserClientLocation | undefined): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => { finish(undefined) }, budgetMs)
    void resolvedClientLocation(signal).then(finish, () => { finish(undefined) })
  })
}
