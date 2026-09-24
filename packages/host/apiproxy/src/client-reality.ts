import { Service, type Context } from '@phoenix-ai/cordis'
import type { SessionId } from '@phoenix-ai/dsh-session/types'
import type { ClientLocation } from './api/sessions.ts'

const LOCATION_TTL_MS = 5 * 60_000
const MAX_LOCATION_AGE_MS = 15 * 60_000
const MAX_FUTURE_SKEW_MS = 60_000

/** Host-only browser location observation. Exact coordinates never enter session history. */
export interface ObservedClientLocation extends ClientLocation {
  readonly source: 'browser-geolocation'
  readonly receivedAt: number
  readonly expiresAt: number
}

declare module '@phoenix-ai/cordis' {
  interface Context {
    /** Short-lived browser reality cache; absent in direct createApiProxy test compositions. */
    clientReality: ClientRealityService
  }
}

/**
 * Ephemeral browser reality cache. It deliberately stores no history and
 * unregisters with the owning ApiProxy fiber.
 */
export class ClientRealityService extends Service {
  private readonly locations = new Map<SessionId, ObservedClientLocation>()

  constructor(ctx: Context) {
    super(ctx, 'clientReality')
  }

  /**
   * Record a browser position only when its observation time is plausibly current.
   * @param sessionId - Session whose browser supplied the observation.
   * @param location - Browser geolocation sample to validate and cache.
   */
  observeLocation(sessionId: SessionId, location: ClientLocation): void {
    const now = Date.now()
    if (location.observedAt > now + MAX_FUTURE_SKEW_MS) return
    if (now - location.observedAt > MAX_LOCATION_AGE_MS) return

    const expiresAt = Math.min(now + LOCATION_TTL_MS, location.observedAt + LOCATION_TTL_MS)
    if (expiresAt <= now) return

    const existing = this.locations.get(sessionId)
    if (existing !== undefined
      && existing.expiresAt > now
      && (existing.observedAt > location.observedAt
        || (existing.observedAt === location.observedAt
          && existing.accuracyMeters <= location.accuracyMeters))) return

    this.locations.set(sessionId, {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracyMeters: location.accuracyMeters,
      observedAt: location.observedAt,
      source: 'browser-geolocation',
      receivedAt: now,
      expiresAt,
    })

    if (this.locations.size > 64) this.prune(now)
  }

  /**
   * Read the current non-expired position for one live/persisted session id.
   * @param sessionId - Session whose current browser location is requested.
   * @returns A defensive copy of the live observation, or undefined when absent or expired.
   */
  locationFor(sessionId: SessionId): ObservedClientLocation | undefined {
    const value = this.locations.get(sessionId)
    if (value === undefined) return undefined
    if (value.expiresAt <= Date.now()) {
      this.locations.delete(sessionId)
      return undefined
    }
    return { ...value }
  }

  private prune(now: number): void {
    for (const [sessionId, value] of this.locations) {
      if (value.expiresAt <= now) this.locations.delete(sessionId)
    }
  }
}
