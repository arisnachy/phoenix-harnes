/**
 * Safe HTTP(S) retrieval for `ctx.web`: validates URLs, follows only same-origin redirects,
 * enforces time and size limits, classifies and decodes text, and leaves presentation to
 * `@phoenix-ai/dsh-tool-web`. Requests carry no browser cookies or ambient credentials.
 *
 * Private/reserved targets are checked at URL resolution AND rejected at socket lookup.
 * The connection uses the inspected public IP, blocking DNS rebinds into private services.
 * A separate network egress policy remains recommended for high-risk deployments.
 * @module @phoenix-ai/dsh-web-fetch-http/provider
 */

import { lookup as dnsLookup } from 'node:dns/promises'
import { Agent } from 'undici'
import { WebError } from '@phoenix-ai/dsh-web'
import type { WebFetchBody, WebFetchProvider, WebFetchRequest, WebFetchResult } from '@phoenix-ai/dsh-web'
import { deadline, timeoutOf } from '@phoenix-ai/dsh-timeout'
import { parseRobots, robotsAllows, type RobotsPolicy } from './robots.ts'
import type { PhoenixWebBotSigner } from './web-bot-auth.ts'
import {
  assertPublicFetchTarget, classifyContentType, decoderForCharset, isSameOrigin,
  parseCharset, selectPublicDialAddress, validateFetchUrl,
} from './policy.ts'

/** Resolved provider limits (the plugin's schemastery Config supplies defaults). */
export interface HttpFetchLimits {
  /** Maximum accepted request URL length. */
  maxUrlLength: number
  /** Maximum response body size in bytes (read is aborted past this). */
  maxResponseBytes: number
  /** Maximum decoded body length in characters (truncated past this). */
  maxBodyChars: number
  /** Default fetch timeout in milliseconds. */
  timeoutMs: number
  /** Maximum number of (same-origin) redirect hops to follow. */
  maxRedirects: number
  /** `User-Agent` header sent on every request. */
  userAgent: string
  /** Test-only escape hatch for an explicitly local fixture server. */
  allowPrivateNetworks: boolean
  /** Honor site robots.txt directives; defaults to true on public networks. */
  respectRobots?: boolean
  /** Optional Ed25519 identity, enabled only after local secret configuration. */
  signer?: PhoenixWebBotSigner
}

/** Stable id this provider registers under. */
export const LOCAL_FETCH_PROVIDER_ID = 'http'

/** The anonymous public HTTP(S) fetch provider. */
export class HttpFetchProvider implements WebFetchProvider {
  readonly id = LOCAL_FETCH_PROVIDER_ID

  private readonly publicDispatcher: Agent | undefined
  private readonly robotsCache = new Map<string, { expires: number; policy?: RobotsPolicy; denied: boolean }>()
  private readonly robotsPending = new Map<string, Promise<{ expires: number; policy?: RobotsPolicy; denied: boolean }>>()
  private readonly nextRequestAt = new Map<string, number>()
  private readonly blockedUntil = new Map<string, number>()

  constructor(private readonly limits: HttpFetchLimits) {
    this.publicDispatcher = limits.allowPrivateNetworks ? undefined : new Agent({
      keepAliveTimeout: 1_000,
      keepAliveMaxTimeout: 1_000,
      connect: {
        // DNS is resolved again at the physical socket, where every address
        // must pass the same private/reserved filter. Return ONLY the vetted
        // address to prevent a rebinding hostname reaching loopback or the LAN.
        lookup(hostname, _options, callback) {
          void dnsLookup(hostname, { all: true, order: 'verbatim' }).then(
            (records) => {
              try {
                const selected = selectPublicDialAddress(hostname, records)
                if (_options.all === true) {
                  const all = callback as unknown as (
                    error: Error | null, addresses: readonly { address: string; family: number }[],
                  ) => void
                  all(null, [selected])
                } else {
                  callback(null, selected.address, selected.family)
                }
              } catch (error) {
                callback(error instanceof Error ? error : new Error(String(error)), '', 4)
              }
            },
            (error: unknown) => { callback(error instanceof Error ? error : new Error(String(error)), '', 4) },
          )
        },
      },
    })
  }

  /** No credentials to check — an anonymous public fetcher is always usable. */
  available(): boolean {
    return true
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    if (signal?.aborted) throw new WebError('web fetch aborted', 'WEB_ABORTED')

    // One signal stops both the request and body read. The deadline's TimeoutReason later
    // distinguishes this provider's timeout from caller or outer-deadline cancellation.
    using d = deadline(signal, this.limits.timeoutMs, 'WEB_FETCH_TIMEOUT')
    return await this.followAndRead(request.url, d.signal)
  }

  /** Follow same-origin redirects up to the hop cap, then read the final response. */
  private async followAndRead(initialUrl: string, signal: AbortSignal): Promise<WebFetchResult> {
    let currentUrl = validateFetchUrl(initialUrl, this.limits.maxUrlLength)
    let redirectsFollowed = 0

    for (;;) {
      if (!this.limits.allowPrivateNetworks) {
        await assertPublicFetchTarget(currentUrl)
        if (this.limits.respectRobots !== false) await this.enforceRobots(currentUrl, signal)
        await this.throttle(currentUrl.origin, signal)
      }
      const response = await this.requestOnce(currentUrl, signal)
      if (response.status === 429 || response.status === 403 || response.status === 503) {
        this.noteBlocked(currentUrl.origin, response)
      }

      if (isRedirectStatus(response.status)) {
        // Enforce the redirect budget before resolving or validating the next hop.
        if (redirectsFollowed >= this.limits.maxRedirects) {
          await response.body?.cancel()
          throw new WebError(`exceeded the maximum of ${this.limits.maxRedirects} redirects`, 'WEB_REDIRECT_BLOCKED')
        }
        const location = response.headers.get('location')
        if (location === null) {
          // A redirect status with no Location is not a usable resource. Cancel
          // the (possibly streaming) body before throwing so no socket leaks.
          await response.body?.cancel()
          throw new WebError(`redirect response (HTTP ${response.status}) without a Location header`, 'WEB_PROVIDER_ERROR')
        }
        const target = resolveRedirect(location, currentUrl)
        // Re-validate the target against the same transport hygiene a direct request gets: a
        // redirect must not be a back door to a credentialed, non-http(s), or over-long URL
        // that validateFetchUrl would reject.
        let validatedTarget: URL
        try {
          validatedTarget = validateFetchUrl(target.toString(), this.limits.maxUrlLength)
          if (!isSameOrigin(validatedTarget, currentUrl)) {
            throw new WebError(
              `cross-origin redirect to ${validatedTarget.origin} is not followed automatically; retry against that URL directly`,
              'WEB_REDIRECT_BLOCKED',
            )
          }
        } catch (error: unknown) {
          await response.body?.cancel()
          throw error
        }
        await response.body?.cancel()
        currentUrl = validatedTarget
        redirectsFollowed++
        continue
      }

      return await this.readBody(response, currentUrl, signal)
    }
  }

  /** Cache robots per origin and coalesce simultaneous preflights. An unavailable robots
   * endpoint fails closed rather than treating a security page as permission. */
  private async enforceRobots(url: URL, signal: AbortSignal): Promise<void> {
    const origin = url.origin
    let record = this.robotsCache.get(origin)
    if (record === undefined || record.expires <= Date.now()) {
      let pending = this.robotsPending.get(origin)
      if (pending === undefined) {
        pending = this.loadRobots(url, signal)
        this.robotsPending.set(origin, pending)
      }
      try {
        record = await pending
        this.robotsCache.set(origin, record)
      } finally {
        if (this.robotsPending.get(origin) === pending) this.robotsPending.delete(origin)
      }
    }
    if (record.denied) throw new WebError(`robots.txt unavailable or restrictive at ${origin}; use another authorized source`, 'WEB_ROBOTS_UNAVAILABLE')
    if (record.policy !== undefined && !robotsAllows(url, record.policy)) {
      throw new WebError(`PHOENIX-ResearchBot is disallowed by robots.txt at ${origin}`, 'WEB_ROBOTS_DISALLOWED')
    }
  }

  private async loadRobots(url: URL, signal: AbortSignal): Promise<{ expires: number; policy?: RobotsPolicy; denied: boolean }> {
    const robotsUrl = new URL('/robots.txt', url.origin)
    await assertPublicFetchTarget(robotsUrl)
    let response: Response
    try {
      response = await this.requestOnce(robotsUrl, signal)
    } catch (error) {
      if (signal.aborted) throw error
      return { denied: true, expires: Date.now() + 60_000 }
    }
    if (response.status === 404 || response.status === 410) {
      await response.body?.cancel()
      return { denied: false, expires: Date.now() + 3_600_000 }
    }
    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel()
      return { denied: true, expires: Date.now() + 60_000 }
    }
    // Do not allocate arbitrarily large robots.txt files supplied by untrusted origins.
    const chunks: Uint8Array[] = []
    let length = 0
    const reader = response.body?.getReader()
    if (reader !== undefined) {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          const remaining = 128_000 - length
          if (remaining <= 0) break
          const accepted = value.subarray(0, remaining)
          chunks.push(accepted)
          length += accepted.byteLength
          if (accepted.byteLength < value.byteLength) break
        }
      } finally {
        await reader.cancel().catch(() => {})
      }
    }
    const policy = parseRobots(new TextDecoder().decode(Buffer.concat(chunks)), 'PHOENIX-ResearchBot')
    return { denied: false, policy, expires: Date.now() + 3_600_000 }
  }

  /** Per-origin cooperative throttle. Honor Crawl-delay, but never stall a tool call for minutes. */
  private async throttle(origin: string, signal: AbortSignal): Promise<void> {
    const cooldown = this.blockedUntil.get(origin) ?? 0
    if (cooldown > Date.now()) throw new WebError(
      `web origin ${origin} has requested a pause; use another source`, 'WEB_PROVIDER_RATE_LIMIT',
    )
    const delay = Math.max(1_000, this.robotsCache.get(origin)?.policy?.crawlDelayMs ?? 0)
    const now = Date.now()
    const slot = Math.max(now, this.nextRequestAt.get(origin) ?? 0)
    if (slot - now > 4_000) {
      throw new WebError(`crawl-delay at ${origin} exceeds the active web-fetch budget`, 'WEB_PROVIDER_RATE_LIMIT')
    }
    this.nextRequestAt.set(origin, slot + delay)
    if (slot <= now) return
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => { clearTimeout(timer); reject(new WebError('web fetch aborted', 'WEB_ABORTED')) }
      const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, slot - now)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) { clearTimeout(timer); signal.removeEventListener('abort', onAbort); reject(new WebError('web fetch aborted', 'WEB_ABORTED')) }
    })
  }

  /** A real block is never brute-forced: remember the host and honor Retry-After. */
  private noteBlocked(origin: string, response: Response): void {
    const raw = response.headers.get('retry-after')
    const seconds = raw === null ? NaN : Number(raw)
    const fromHeader = Number.isFinite(seconds) ? seconds * 1000 : raw === null ? NaN : Date.parse(raw) - Date.now()
    const fallback = response.status === 403 ? 120_000 : 60_000
    const delay = Number.isFinite(fromHeader) ? Math.min(900_000, Math.max(5_000, fromHeader)) : fallback
    this.blockedUntil.set(origin, Math.max(this.blockedUntil.get(origin) ?? 0, Date.now() + delay))
  }

  private async requestOnce(url: URL, signal: AbortSignal): Promise<Response> {
    try {
      const options: RequestInit & { dispatcher?: Agent } = {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'user-agent': this.limits.userAgent,
          'accept': 'text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8',
          ...(this.limits.signer !== undefined && url.protocol === 'https:'
            ? this.limits.signer.signRequest(url) : {}),
        },
        signal,
        ...(this.publicDispatcher === undefined ? {} : { dispatcher: this.publicDispatcher }),
      }
      return await fetch(url, options)
    } catch (error: unknown) {
      throw translateAbortOrNetwork(error, signal)
    }
  }

  /** Read, byte-cap, classify, and decode the final response body. */
  private async readBody(response: Response, finalUrl: URL, signal: AbortSignal): Promise<WebFetchResult> {
    const contentType = response.headers.get('content-type')
    const kind = classifyContentType(contentType)
    if (kind === undefined) {
      await response.body?.cancel()
      throw new WebError(`unsupported content type "${contentType ?? 'unknown'}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE')
    }

    // Resolve the decoder BEFORE reading the body so an unsupported charset
    // fails without consuming the stream — but cancel the body on that failure
    // so the socket does not leak (matching the unsupported-content-type path).
    let decoder: TextDecoder
    try {
      decoder = decoderForCharset(parseCharset(contentType))
    } catch (error: unknown) {
      await response.body?.cancel()
      throw error
    }
    const { bytes, truncatedByBytes } = await this.readCapped(response, signal)
    const decoded = decoder.decode(bytes)
    const truncatedByChars = decoded.length > this.limits.maxBodyChars
    const content = truncatedByChars ? decoded.slice(0, this.limits.maxBodyChars) : decoded
    const body: WebFetchBody = kind === 'html' ? { kind: 'html', content } : { kind: 'text', content }

    return {
      url: finalUrl.toString(),
      statusCode: response.status,
      body,
      truncated: truncatedByBytes || truncatedByChars,
    }
  }

  /**
   * Read the response stream up to `maxResponseBytes`. A `Content-Length` over
   * the cap rejects immediately with `WEB_FETCH_TOO_LARGE`; a stream that grows
   * past the cap is cut short (`truncatedByBytes`) rather than rejected, so a
   * server that under-reports still yields a bounded usable body.
   */
  private async readCapped(response: Response, signal: AbortSignal): Promise<{ bytes: Uint8Array; truncatedByBytes: boolean }> {
    const declared = response.headers.get('content-length')
    if (declared !== null) {
      const length = Number(declared)
      if (Number.isFinite(length) && length > this.limits.maxResponseBytes) {
        await response.body?.cancel()
        throw new WebError(`response exceeds the maximum of ${this.limits.maxResponseBytes} bytes`, 'WEB_FETCH_TOO_LARGE')
      }
    }

    /* v8 ignore next -- a 2xx Response from fetch always exposes a body stream; the null guard is defensive. */
    if (response.body === null) return { bytes: new Uint8Array(0), truncatedByBytes: false }

    const chunks: Uint8Array[] = []
    let total = 0
    let truncatedByBytes = false
    const reader = response.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const remaining = this.limits.maxResponseBytes - total
        // Only DROPPED bytes count as truncation: a chunk that exactly fills the
        // remaining capacity keeps all its bytes and we read on to observe EOF,
        // so an exactly-at-cap body is not falsely flagged truncated.
        if (value.byteLength > remaining) {
          chunks.push(value.subarray(0, remaining))
          total += remaining
          truncatedByBytes = true
          break
        }
        chunks.push(value)
        total += value.byteLength
      }
    } catch (error: unknown) {
      /* v8 ignore next -- mid-stream read fault needs a network drop after headers; translate path covered by request-phase tests. */
      throw translateAbortOrNetwork(error, signal)
    } finally {
      /* v8 ignore next 4 -- cancel() after a completed/broken read settles without rejecting; unobserved best-effort cleanup. */
      await reader.cancel().catch(() => {
        // Cancel after a successful read (or after we broke past the cap) is
        // best-effort cleanup; the bytes we need are already collected.
      })
    }

    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { bytes, truncatedByBytes }
  }
}

/** HTTP redirect status codes that carry a `Location`. */
function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

/** Resolve a (possibly relative) `Location` against the current URL. */
function resolveRedirect(location: string, base: URL): URL {
  try {
    return new URL(location, base)
  } catch (error: unknown) {
    /* v8 ignore next 2 -- URL resolution against a valid absolute base effectively never throws; defensive guard. */
    throw new WebError(`invalid redirect Location "${location}"`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
}

/**
 * Translate a thrown fetch/stream error into a `WebError`, classified by the
 * deadline signal rather than the thrown value (which differs by phase: the
 * request-phase `fetch` rejects with the abort reason, while the read-phase
 * reader surfaces a bare `AbortError`). `timeoutOf(signal, 'WEB_FETCH_TIMEOUT')`
 * recovering OUR reason means our timeout fired (`WEB_FETCH_TIMEOUT`); any other
 * abort — an upstream cancel, or a foreign/outer deadline's timeout under
 * nesting — is `WEB_ABORTED`; a throw with the signal NOT aborted is a
 * transport/network failure (`WEB_PROVIDER_ERROR`).
 */
function translateAbortOrNetwork(error: unknown, signal: AbortSignal): WebError {
  const timeout = timeoutOf(signal, 'WEB_FETCH_TIMEOUT')
  if (timeout !== undefined) return new WebError('web fetch timed out', 'WEB_FETCH_TIMEOUT', { cause: timeout })
  if (signal.aborted) return new WebError('web fetch aborted', 'WEB_ABORTED', { cause: error })
  return new WebError(`web fetch failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
}
