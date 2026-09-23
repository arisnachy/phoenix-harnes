/**
 * Ephemeral credential prompt messages exchanged with the Phoenix Desktop
 * WebView2 host. This module deliberately has no connection, session, or
 * telemetry dependency: the only response path is the native postMessage
 * bridge.
 */

const MAX_REQUEST_ID_LENGTH = 128
const MAX_ORIGIN_LENGTH = 256
const MAX_ACCOUNT_LENGTH = 512
const MAX_SECRET_LENGTH = 4096

/** Message the native host publishes for one pending browser login. */
export interface NativeCredentialRequest {
  readonly kind: 'computer-credential'
  readonly requestId: string
  readonly origin: string
  readonly legacyCredentialPresent: boolean
}

/** Message sent to the native host after the person submits the prompt. */
export interface NativeCredentialResponse {
  readonly kind: 'computer-credential-response'
  readonly requestId: string
  readonly origin: string
  readonly account: string
  readonly secret: string
  readonly remember: boolean
}

/** Message sent when a person closes a pending native credential prompt. */
export interface NativeCredentialCancellation {
  readonly kind: 'computer-credential-cancelled'
  readonly requestId: string
  readonly origin: string
}

/** Message published when the host invalidates a prompt after navigation or shutdown. */
export interface NativeCredentialDismissal {
  readonly kind: 'computer-credential-dismissed'
  readonly requestId: string
  readonly origin: string
}

interface NativeWebView {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  postMessage(message: NativeCredentialResponse | NativeCredentialCancellation): void
}

interface NativeWindow extends Window {
  readonly chrome?: { readonly webview?: NativeWebView }
}

function nativeWebView(): NativeWebView | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as NativeWindow).chrome?.webview
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}

/**
 * Convert an HTTPS URL to the canonical origin used by the host protocol.
 * Paths are intentionally discarded because a credential belongs to an
 * origin, while HTTP and URL credentials are rejected.
 * @param value - candidate origin received from the native host.
 * @returns the canonical HTTPS origin, or undefined for an invalid value.
 */
export function canonicalCredentialOrigin(value: unknown): string | undefined {
  if (!boundedString(value, MAX_ORIGIN_LENGTH)) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return undefined
    if (url.hostname === '') return undefined
    return url.origin
  } catch {
    return undefined
  }
}

/**
 * Narrow untrusted WebView2 message data to the prompt request protocol.
 * @param value - data carried by a WebView2 message event.
 * @returns a bounded request, or undefined when the data is not a request.
 */
export function parseNativeCredentialRequest(value: unknown): NativeCredentialRequest | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  if (candidate.kind !== 'computer-credential') return undefined
  if (!boundedString(candidate.requestId, MAX_REQUEST_ID_LENGTH)) return undefined
  const origin = canonicalCredentialOrigin(candidate.origin)
  if (origin === undefined || candidate.origin !== origin) return undefined
  if (typeof candidate.legacyCredentialPresent !== 'boolean') return undefined
  return {
    kind: 'computer-credential',
    requestId: candidate.requestId,
    origin,
    legacyCredentialPresent: candidate.legacyCredentialPresent,
  }
}

/**
 * Validate a host dismissal so only the matching ephemeral prompt is cleared.
 * @param value - untrusted data received from the native host.
 * @returns a valid dismissal, or undefined when the message does not match.
 */
export function parseNativeCredentialDismissal(value: unknown): NativeCredentialDismissal | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  if (candidate.kind !== 'computer-credential-dismissed') return undefined
  if (!boundedString(candidate.requestId, MAX_REQUEST_ID_LENGTH)) return undefined
  const origin = canonicalCredentialOrigin(candidate.origin)
  if (origin === undefined || candidate.origin !== origin) return undefined
  return { kind: 'computer-credential-dismissed', requestId: candidate.requestId, origin }
}

/**
 * Validate the bounded response before it crosses the native bridge.
 * @param response - response assembled by the prompt form.
 * @returns true when every response field is safe to post.
 */
export function isNativeCredentialResponse(response: NativeCredentialResponse): boolean {
  return boundedString(response.requestId, MAX_REQUEST_ID_LENGTH)
    && canonicalCredentialOrigin(response.origin) === response.origin
    && boundedString(response.account, MAX_ACCOUNT_LENGTH)
    && response.secret.length <= MAX_SECRET_LENGTH
    && response.secret.length > 0
    && typeof response.remember === 'boolean'
}

/**
 * Subscribe to the ephemeral native prompt channel.
 * @param onRequest - callback for a validated request.
 * @param onDismissal - optional callback for a matching prompt dismissal.
 * @returns a disposer that removes the WebView2 event listener.
 */
export function subscribeNativeCredentialRequests(
  onRequest: (request: NativeCredentialRequest) => void,
  onDismissal?: (dismissal: NativeCredentialDismissal) => void,
): () => void {
  const webview = nativeWebView()
  if (webview === undefined) return () => {}
  const listener = (event: MessageEvent<unknown>) => {
    const request = parseNativeCredentialRequest(event.data)
    if (request !== undefined) {
      onRequest(request)
      return
    }
    const dismissal = parseNativeCredentialDismissal(event.data)
    if (dismissal !== undefined) onDismissal?.(dismissal)
  }
  webview.addEventListener('message', listener)
  return () => { webview.removeEventListener('message', listener) }
}

/**
 * Send a credential response only through the WebView2 native bridge.
 * @param response - prompt response; it is never returned to a caller.
 */
export function postNativeCredentialResponse(response: NativeCredentialResponse): void {
  if (!isNativeCredentialResponse(response)) throw new Error('Invalid native credential response')
  const webview = nativeWebView()
  if (webview === undefined) throw new Error('Native credential bridge unavailable')
  webview.postMessage({
    kind: response.kind,
    requestId: response.requestId,
    origin: response.origin,
    account: response.account,
    secret: response.secret,
    remember: response.remember,
  })
}

/**
 * Cancel one pending native credential request without sending account data.
 * @param cancellation - request identifier and origin to cancel.
 */
export function postNativeCredentialCancellation(cancellation: NativeCredentialCancellation): void {
  if (!boundedString(cancellation.requestId, MAX_REQUEST_ID_LENGTH)
    || canonicalCredentialOrigin(cancellation.origin) !== cancellation.origin) {
    throw new Error('Invalid native credential cancellation')
  }
  const webview = nativeWebView()
  if (webview === undefined) throw new Error('Native credential bridge unavailable')
  webview.postMessage({
    kind: cancellation.kind,
    requestId: cancellation.requestId,
    origin: cancellation.origin,
  })
}
