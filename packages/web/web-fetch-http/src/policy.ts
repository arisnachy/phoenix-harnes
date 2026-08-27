/**
 * URL validation and content-type classification for the local HTTP(S) fetch
 * provider — the pure, network-free half. The provider's `fetch()` composes
 * these with transport (redirect following, byte caps, decoding).
 *
 * @module @deepseek-ai/dsh-web-fetch-http/policy
 */

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { WebError } from '@deepseek-ai/dsh-web'

/** The body kinds this provider decodes. */
export type FetchableKind = 'html' | 'text'

/**
 * Validate a request URL against the basic transport hygiene the provider
 * enforces before any network access: http(s) only, no embedded credentials,
 * bounded length. Returns the parsed `URL`. Throws {@link WebError} otherwise.
 * Private-network blocking is enforced immediately before transport by {@link assertPublicFetchTarget}.
 *
 * @param input - the raw URL string from the fetch request.
 * @param maxUrlLength - inclusive upper bound on `input`'s length.
 * @returns the parsed `URL`.
 */
export function validateFetchUrl(input: string, maxUrlLength: number): URL {
  if (input.length > maxUrlLength) {
    throw new WebError(`URL exceeds the maximum length of ${maxUrlLength}`, 'WEB_INVALID_URL')
  }
  let url: URL
  try {
    url = new URL(input)
  } catch (error: unknown) {
    throw new WebError(`invalid URL: ${input}`, 'WEB_INVALID_URL', { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebError(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`, 'WEB_INVALID_URL')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new WebError('credentials in URLs are not allowed', 'WEB_BLOCKED_URL')
  }
  return url
}

/**
 * Resolve every address for a hostname and reject private or reserved targets.
 * This check runs immediately before each request and redirect; deployments
 * needing stronger DNS-rebinding protection should route through an egress proxy.
 *
 * @param url - validated HTTP(S) target.
 * @returns a promise that resolves only for public address resolution.
 */
export async function assertPublicFetchTarget(url: URL): Promise<void> {
  if (isPrivateAddress(url.hostname)) {
    throw new WebError(`private or reserved network target is blocked: ${url.hostname}`, 'WEB_BLOCKED_URL')
  }
  if (isIP(url.hostname) !== 0) return
  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(url.hostname, { all: true, order: 'verbatim' })
  } catch (error: unknown) {
    throw new WebError(`could not resolve web target ${url.hostname}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new WebError(`private or reserved network resolution is blocked: ${url.hostname}`, 'WEB_BLOCKED_URL')
  }
}

function isPrivateAddress(value: string): boolean {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, '')
  if (isIP(normalized) === 4) {
    const octets = normalized.split('.').map(Number)
    const first = octets[0] ?? -1
    const second = octets[1] ?? -1
    const third = octets[2] ?? -1
    return first === 0 || first === 10 || first === 127 || first === 224 || first >= 240
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && (second === 168 || (second === 0 && third === 0) || (second === 0 && third === 2)))
      || (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100)))
      || (first === 203 && second === 0 && third === 113)
  }
  if (isIP(normalized) === 6) {
    const compact = normalized.replace(/^0*:0*:0*:0*:0*:ffff:/, '')
    if (isIP(compact) === 4) return isPrivateAddress(compact)
    const first = Number.parseInt(normalized.split(':')[0] || '0', 16)
    return normalized === '::' || normalized === '::1' || first === 0xfc00 || (first >= 0xfc00 && first <= 0xfdff)
      || (first >= 0xfe80 && first <= 0xfebf) || first >= 0xff00 || normalized.startsWith('2001:db8:')
  }
  return false
}

/**
 * Two URLs are same-origin when scheme, hostname, and port match. A redirect
 * that crosses origins is refused so each new origin requires a fresh tool call
 * (and thus a fresh provider/permission decision).
 *
 * @param a - one of the two URLs to compare.
 * @param b - the other URL to compare.
 * @returns true when `a` and `b` share scheme, hostname, and port.
 */
export function isSameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port
}

/**
 * Classify a response `Content-Type` into a decodable body kind, or `undefined`
 * for an unsupported (e.g. binary) type. `text/html` and `application/xhtml+xml`
 * are `html`; other `text/*` plus a few structured text types are `text`.
 *
 * @param contentType - the raw `Content-Type` header, or `null` when the
 *   response carries none (unsupported).
 * @returns the decodable kind, or `undefined` for an unsupported type.
 */
export function classifyContentType(contentType: string | null): FetchableKind | undefined {
  const mime = (contentType ?? '').replace(/;.*$/s, '').trim().toLowerCase()
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html'
  if (mime.startsWith('text/')) return 'text'
  if (mime === 'application/json' || mime === 'application/xml' || mime.endsWith('+json') || mime.endsWith('+xml')) return 'text'
  return undefined
}

/**
 * Extract the `charset` parameter from a response `Content-Type`, lower-cased,
 * or `undefined` when absent. The provider feeds this label to `TextDecoder`
 * so a non-UTF-8 response is decoded with its declared encoding rather than
 * silently mangled into replacement characters.
 *
 * @param contentType - the raw `Content-Type` header, or `null` when the
 *   response carries none.
 * @returns the lower-cased charset label, or `undefined` when none is declared.
 */
export function parseCharset(contentType: string | null): string | undefined {
  const match = /;\s*charset\s*=\s*"?([^";]+)"?/i.exec(contentType ?? '')
  return match?.[1]?.trim().toLowerCase()
}

/**
 * Build a `TextDecoder` for the declared charset, falling back to UTF-8 when
 * none is declared. Throws {@link WebError} `WEB_UNSUPPORTED_CONTENT_TYPE` when
 * the label is present but not a charset `TextDecoder` recognizes — better to
 * fail loudly than return mojibake.
 *
 * @param charset - the declared charset label (from {@link parseCharset}), or
 *   `undefined` to default to UTF-8.
 * @returns a decoder for the declared (or defaulted) encoding.
 */
export function decoderForCharset(charset: string | undefined): TextDecoder {
  if (charset === undefined) return new TextDecoder('utf-8')
  try {
    return new TextDecoder(charset)
  } catch (error: unknown) {
    throw new WebError(`unsupported charset "${charset}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE', { cause: error })
  }
}
