/** Browser-owned geolocation sampling for ephemeral Reality Context provenance. */

export interface BrowserClientLocation {
  readonly latitude: number
  readonly longitude: number
  readonly accuracyMeters: number
  readonly observedAt: number
}

const CACHE_MAX_AGE_MS = 60_000
const GEOLOCATION_TIMEOUT_MS = 1_200
const EXPLICIT_LOCATION_TIMEOUT_MS = 8_000

/** Only a direct, standalone request for the user's current location may open the browser consent UI. */
export function isExplicitLocationRequest(text: string): boolean {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    .replace(/^[¿?¡!\s]+|[¿?¡!.\s]+$/g, '').replace(/\s+/g, ' ')
  return /^(?:(?:kira|phoenix)[,:]? [¿?¡!]*)?(?:y )?(?:(?:donde (?:estoy|estamos)(?: ubicad[oa]s?)?(?: ahora(?: mismo)?)?)|(?:cual es (?:mi|nuestra) ubicacion(?: actual)?)|(?:dime (?:mi|nuestra) ubicacion(?: actual)?)|(?:where (?:am i|are we)(?: right now)?)|(?:what is my (?:current )?location)|(?:show my (?:current )?location))$/.test(normalized)
}

let cached: BrowserClientLocation | undefined
let inFlight: Promise<BrowserClientLocation | undefined> | undefined

function usableCached(now: number): BrowserClientLocation | undefined {
  if (cached === undefined) return undefined
  if (cached.observedAt > now + 60_000) return undefined
  if (now - cached.observedAt > CACHE_MAX_AGE_MS) return undefined
  return cached
}

async function permissionState(): Promise<PermissionState | 'unavailable'> {
  if (typeof navigator === 'undefined'
    || navigator.geolocation === undefined
    || navigator.permissions === undefined) return 'unavailable'
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' })
    return status.state
  } catch {
    return 'unavailable'
  }
}

function samplePosition(signal?: AbortSignal, explicit = false): Promise<BrowserClientLocation | undefined> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(undefined)
      return
    }
    let settled = false
    let deadline: ReturnType<typeof setTimeout> | undefined
    const finish = (value: BrowserClientLocation | undefined): void => {
      if (settled) return
      settled = true
      if (deadline !== undefined) clearTimeout(deadline)
      signal?.removeEventListener('abort', onAbort)
      resolve(value)
    }
    const onAbort = (): void => { finish(undefined) }
    signal?.addEventListener('abort', onAbort, { once: true })
    deadline = setTimeout(() => finish(undefined), explicit ? EXPLICIT_LOCATION_TIMEOUT_MS + 2_000 : GEOLOCATION_TIMEOUT_MS + 500)
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
          enableHighAccuracy: false,
          maximumAge: CACHE_MAX_AGE_MS,
          timeout: explicit ? EXPLICIT_LOCATION_TIMEOUT_MS : GEOLOCATION_TIMEOUT_MS,
        },
      )
    } catch {
      finish(undefined)
    }
  })
}

/**
 * Passive sampling requires an existing grant. A direct standalone user
 * location request may open the browser's own permission UI, never bypass it.
 * A denied permission is always respected.
 * @param explicit - whether the user directly requested their own current location.
  * @param signal - signal supplied to this public operation.
  * @returns Result produced by this public operation.
 */
export async function resolvedClientLocation(
  signal?: AbortSignal,
  explicit = false,
): Promise<BrowserClientLocation | undefined> {
  if (signal?.aborted) return undefined
  const state = await permissionState()
  if (state === 'denied' || (!explicit && state !== 'granted')) {
    cached = undefined
    return undefined
  }
  if (signal?.aborted) return undefined
  const cachedValue = state === 'granted' ? usableCached(Date.now()) : undefined
  if (cachedValue !== undefined) return cachedValue
  if (!explicit && inFlight !== undefined) {
    const value = await inFlight
    return !signal?.aborted && await permissionState() === 'granted' ? value : undefined
  }
  const job = samplePosition(signal, explicit).then(async value => {
    const after = await permissionState()
    if (signal?.aborted || after === 'denied' || (after !== 'granted' && !(explicit && after === 'unavailable'))) {
      cached = undefined
      return undefined
    }
    return value
  }).finally(() => {
    if (inFlight === job) inFlight = undefined
  })
  if (!explicit) inFlight = job
  return job
}
