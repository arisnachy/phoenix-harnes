/**
 * Host-only Google OAuth broker. It uses Google's installed-application
 * Authorization Code flow with loopback redirect, PKCE S256, and state. OAuth
 * tokens remain private to this Service instance; the credential store gets
 * only a marker after login, and API consumers receive HTTP results rather
 * than Bearer or refresh tokens.
 *
 * @module @deepseek-ai/dsh-authorization/google
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Service, type Context } from '@deepseek-ai/cordis'
import { credentialKey, type CredentialKey } from '@deepseek-ai/dsh-credentials'
import { AuthorizationError, type AuthorizationSession, type AuthorizationTelemetry } from './index.ts'

/** Durable secret-free marker for the Google account owned by this broker. */
export const GOOGLE_ACCOUNT_KEY: CredentialKey = credentialKey('authorization-google', 'account')

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
const LOOPBACK_HOST = '127.0.0.1'
const CALLBACK_PATH = '/oauth2/callback'
const EXPIRY_SKEW_MS = 60_000

/** Deployment configuration. */
export interface Config {
  /** Google OAuth Desktop client id. It is not a password or user credential. */
  clientId?: string
  /** OAuth scopes the human may approve. Later requests fail closed outside this grant. */
  scopes: readonly string[]
}

interface ResolvedSpec {
  clientId?: string
  scopes: readonly string[]
}

interface GoogleGrant {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  scopes: ReadonlySet<string>
}

interface TokenResponse {
  access_token: string
  expires_in: number
  token_type: string
  refresh_token?: string
  scope?: string
}

/** One Host-side Google API operation through the broker. */
export interface GoogleApiRequest {
  /** HTTPS URL under `*.googleapis.com` or `www.googleapis.com`; OAuth endpoints are excluded. */
  url: string
  /** HTTP method; defaults to GET. */
  method?: string
  /** Every scope needed by this operation. */
  requiredScopes: readonly string[]
  /** Caller headers; authentication and cookie headers are forbidden. */
  headers?: Readonly<Record<string, string>>
  /** Optional body forwarded unchanged. */
  body?: BodyInit | null
  /** Optional cancellation signal. */
  signal?: AbortSignal
}

/** Secret-free Google API result. Response headers are not forwarded wholesale. */
export interface GoogleApiResponse {
  /** HTTP status. */
  status: number
  /** Whether the HTTP status is successful. */
  ok: boolean
  /** Response media type, when present. */
  contentType?: string
  /** Response body text. */
  body: string
}

interface LoopbackReceiver {
  redirectUri: string
  code: Promise<string>
  close(): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host-only Google API broker; credentials never cross this service API. */
    googleApi: GoogleApiBroker
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Resolve broker configuration without inventing deployment scopes.
 * @param config - raw broker configuration.
 * @returns trimmed client id when present and unique scopes.
 */
export function resolveGoogleSpec(config: Config): ResolvedSpec {
  if (!Array.isArray(config.scopes) || config.scopes.length === 0) {
    throw new TypeError('authorization-google: scopes must contain at least one OAuth scope')
  }
  const scopes = config.scopes.map((scope) => {
    if (!nonEmpty(scope)) throw new TypeError('authorization-google: every scope must be a non-empty string')
    return scope.trim()
  })
  if (new Set(scopes).size !== scopes.length) {
    throw new TypeError('authorization-google: scopes must not contain duplicates')
  }
  const clientId = nonEmpty(config.clientId) ? config.clientId.trim() : undefined
  return clientId === undefined ? { scopes } : { clientId, scopes }
}

function base64url(value: Buffer): string {
  return value.toString('base64url')
}

function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48))
  return {
    verifier,
    challenge: base64url(createHash('sha256').update(verifier, 'ascii').digest()),
  }
}

function parseGrantedScopes(value: string | undefined): ReadonlySet<string> {
  if (!nonEmpty(value)) {
    throw new AuthorizationError(
      'Google did not report the scopes actually granted; refusing to assume consent',
      'GOOGLE_SCOPE_UNVERIFIED',
    )
  }
  return new Set(value.trim().split(/\s+/u))
}

function parseTokenResponse(value: unknown): TokenResponse {
  if (value === null || typeof value !== 'object') {
    throw new AuthorizationError('Google returned an invalid token response', 'GOOGLE_TOKEN_RESPONSE')
  }
  const token = value as Partial<TokenResponse>
  if (!nonEmpty(token.access_token)
    || typeof token.expires_in !== 'number'
    || !Number.isFinite(token.expires_in)
    || token.expires_in <= 0
    || !nonEmpty(token.token_type)) {
    throw new AuthorizationError('Google returned an incomplete token response', 'GOOGLE_TOKEN_RESPONSE')
  }
  if (token.refresh_token !== undefined && !nonEmpty(token.refresh_token)) {
    throw new AuthorizationError('Google returned an invalid refresh credential', 'GOOGLE_TOKEN_RESPONSE')
  }
  if (token.scope !== undefined && typeof token.scope !== 'string') {
    throw new AuthorizationError('Google returned an invalid scope list', 'GOOGLE_TOKEN_RESPONSE')
  }
  return token as TokenResponse
}

async function readTokenResponse(response: Response): Promise<TokenResponse> {
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new AuthorizationError('Google returned a non-JSON token response', 'GOOGLE_TOKEN_RESPONSE')
  }
  return parseTokenResponse(value)
}

function form(fields: Readonly<Record<string, string>>): URLSearchParams {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(fields)) body.set(key, value)
  return body
}

function isAllowedApiUrl(url: URL): boolean {
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return false
  if (url.hostname === 'www.googleapis.com') return true
  return url.hostname.endsWith('.googleapis.com') && url.hostname !== 'oauth2.googleapis.com'
}

function callerHeaders(headers: Readonly<Record<string, string>> | undefined): Headers {
  const result = new Headers()
  for (const [name, value] of Object.entries(headers ?? {})) {
    const lower = name.toLowerCase()
    if (lower === 'authorization' || lower === 'proxy-authorization' || lower === 'cookie' || lower === 'set-cookie') {
      throw new AuthorizationError(`Google broker refuses caller credential header "${name}"`, 'GOOGLE_HEADER_DENIED')
    }
    result.set(name, value)
  }
  return result
}

function apiFetchInit(request: GoogleApiRequest, headers: Headers): RequestInit {
  return {
    method: request.method ?? 'GET',
    headers,
    ...(request.body === undefined ? {} : { body: request.body }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  }
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(0, LOOPBACK_HOST)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    await new Promise<void>(resolve => server.close(() => resolve()))
    throw new AuthorizationError('Google loopback receiver did not bind an IP port', 'GOOGLE_CALLBACK_BIND')
  }
  return (address as AddressInfo).port
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close((error) => { error === undefined ? resolve() : reject(error) })
  })
}

async function openLoopback(expectedState: string, signal: AbortSignal): Promise<LoopbackReceiver> {
  const settled = Promise.withResolvers<string>()
  let finished = false
  const server = createServer((request, response) => {
    const finish = (status: number, text: string): void => {
      response.statusCode = status
      response.setHeader('content-type', 'text/plain; charset=utf-8')
      response.setHeader('cache-control', 'no-store')
      response.end(text)
    }
    if (request.method !== 'GET' || request.url === undefined) {
      finish(404, 'Not found')
      return
    }
    const callback = new URL(request.url, `http://${LOOPBACK_HOST}`)
    if (callback.pathname !== CALLBACK_PATH) {
      finish(404, 'Not found')
      return
    }
    if (finished) {
      finish(409, 'Authorization already completed. Return to PHOENIX.')
      return
    }
    if (callback.searchParams.get('state') !== expectedState) {
      finished = true
      finish(400, 'Authorization rejected. Return to PHOENIX and try again.')
      settled.reject(new AuthorizationError('Google OAuth state did not match', 'GOOGLE_STATE_MISMATCH'))
      return
    }
    if (callback.searchParams.get('error') !== null) {
      finished = true
      finish(400, 'Google authorization was not completed. Return to PHOENIX.')
      settled.reject(new AuthorizationError('Google authorization was declined or refused', 'GOOGLE_AUTH_REFUSED'))
      return
    }
    const code = callback.searchParams.get('code')
    if (!nonEmpty(code)) {
      finished = true
      finish(400, 'Authorization response was incomplete. Return to PHOENIX.')
      settled.reject(new AuthorizationError('Google returned no authorization code', 'GOOGLE_CODE_MISSING'))
      return
    }
    finished = true
    finish(200, 'Google authorization completed. You can close this tab and return to PHOENIX.')
    settled.resolve(code)
  })
  const port = await listen(server)
  const onAbort = (): void => {
    if (!finished) {
      finished = true
      settled.reject(signal.reason ?? new Error('Google authorization cancelled'))
    }
    void closeServer(server)
  }
  signal.addEventListener('abort', onAbort, { once: true })
  return {
    redirectUri: `http://${LOOPBACK_HOST}:${String(port)}${CALLBACK_PATH}`,
    code: settled.promise.finally(() => { signal.removeEventListener('abort', onAbort) }),
    close: () => closeServer(server),
  }
}

function createAuthorizationUrl(spec: ResolvedSpec, redirectUri: string, state: string, challenge: string): string {
  const clientId = spec.clientId
  if (clientId === undefined) {
    throw new AuthorizationError(
      'Google OAuth is not configured. Set PHOENIX_GOOGLE_OAUTH_CLIENT_ID to a Google Desktop OAuth client id and restart PHOENIX.',
      'GOOGLE_CLIENT_UNCONFIGURED',
    )
  }
  const url = new URL(GOOGLE_AUTH_ENDPOINT)
  for (const [key, value] of Object.entries({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: spec.scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
  })) url.searchParams.set(key, value)
  return url.toString()
}

/** Google host broker. Tokens are private and no method returns them. */
export default class GoogleApiBroker extends Service {
  static inject = ['authorization', 'credentials']

  private readonly spec: ResolvedSpec
  private grant?: GoogleGrant
  private refreshInFlight?: Promise<GoogleGrant>

  constructor(ctx: Context, config: Config) {
    super(ctx, 'googleApi')
    this.spec = resolveGoogleSpec(config)
    ctx.effect(() => ctx.authorization.registerFlow({
      key: GOOGLE_ACCOUNT_KEY,
      label: 'Google Workspace',
      methods: [{ id: 'oauth', label: 'Sign in with Google' }],
      inspect: () => this.inspect(),
      run: session => this.authorize(session),
    }))
  }

  /** @returns secret-free account telemetry for authorization surfaces. */
  inspect(): Promise<AuthorizationTelemetry | undefined> {
    return Promise.resolve(this.grant === undefined ? undefined : {
      kind: 'account',
      provider: 'google',
      accountType: 'oauth',
    })
  }

  /**
   * Execute one Google API request without exposing the Bearer token.
   * @param request - destination, required scopes, and HTTP payload.
   * @returns secret-free HTTP result.
   */
  async request(request: GoogleApiRequest): Promise<GoogleApiResponse> {
    const url = new URL(request.url)
    if (!isAllowedApiUrl(url)) {
      throw new AuthorizationError('Google broker destination is not an allowed Google API host', 'GOOGLE_DESTINATION_DENIED')
    }
    const headers = callerHeaders(request.headers)
    const required = new Set(request.requiredScopes)
    if (required.size !== request.requiredScopes.length || [...required].some(scope => !nonEmpty(scope))) {
      throw new AuthorizationError('Google broker requiredScopes must be unique non-empty strings', 'GOOGLE_SCOPE_INVALID')
    }
    const grant = await this.usableGrant(required, request.signal)
    headers.set('authorization', `Bearer ${grant.accessToken}`)
    const response = await internals.fetch(url, apiFetchInit(request, headers))
    const contentType = response.headers.get('content-type') ?? undefined
    const body = await response.text()
    return {
      status: response.status,
      ok: response.ok,
      ...(contentType === undefined ? {} : { contentType }),
      body,
    }
  }

  /**
   * Clear the process session and marker, attempting Google revocation first.
   * @returns whether the provider acknowledged revocation; local cleanup always completes.
   */
  async disconnect(): Promise<{ revoked: boolean }> {
    const grant = this.grant
    this.grant = undefined
    this.refreshInFlight = undefined
    let revoked = grant === undefined
    if (grant !== undefined) {
      const token = grant.refreshToken ?? grant.accessToken
      try {
        revoked = (await internals.fetch(GOOGLE_REVOKE_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form({ token }),
        })).ok
      } catch {
        revoked = false
      }
    }
    await this.ctx.credentials.deleteRecord(GOOGLE_ACCOUNT_KEY)
    return { revoked }
  }

  private async authorize(session: AuthorizationSession): Promise<void> {
    const clientId = this.spec.clientId
    if (clientId === undefined) {
      throw new AuthorizationError(
        'Google OAuth is not configured. Set PHOENIX_GOOGLE_OAUTH_CLIENT_ID to a Google Desktop OAuth client id and restart PHOENIX.',
        'GOOGLE_CLIENT_UNCONFIGURED',
      )
    }
    const state = base64url(randomBytes(32))
    const pkce = createPkce()
    const receiver = await internals.openLoopback(state, session.signal)
    try {
      session.notify({
        message: 'Continue with Google in your browser. PHOENIX keeps OAuth tokens inside the host broker.',
        url: createAuthorizationUrl(this.spec, receiver.redirectUri, state, pkce.challenge),
      })
      const code = await receiver.code
      const response = await internals.fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form({
          client_id: clientId,
          code,
          code_verifier: pkce.verifier,
          grant_type: 'authorization_code',
          redirect_uri: receiver.redirectUri,
        }),
        signal: session.signal,
      })
      if (!response.ok) {
        throw new AuthorizationError(`Google token exchange failed with HTTP ${String(response.status)}`, 'GOOGLE_TOKEN_EXCHANGE')
      }
      const token = await readTokenResponse(response)
      if (token.token_type.toLowerCase() !== 'bearer') {
        throw new AuthorizationError('Google returned an unsupported token type', 'GOOGLE_TOKEN_RESPONSE')
      }
      const scopes = parseGrantedScopes(token.scope)
      if (this.spec.scopes.some(scope => !scopes.has(scope))) {
        throw new AuthorizationError(
          'Google did not grant every configured scope; related capabilities remain disconnected',
          'GOOGLE_SCOPE_PARTIAL',
        )
      }
      this.grant = {
        accessToken: token.access_token,
        ...(token.refresh_token === undefined ? {} : { refreshToken: token.refresh_token }),
        expiresAt: internals.now() + token.expires_in * 1000,
        scopes,
      }
      await this.ctx.credentials.modifyRecord(GOOGLE_ACCOUNT_KEY, () => Promise.resolve({ kind: 'api-key' }))
    } finally {
      await receiver.close()
    }
  }

  private async usableGrant(required: ReadonlySet<string>, signal?: AbortSignal): Promise<GoogleGrant> {
    const current = this.grant
    if (current === undefined) {
      throw new AuthorizationError('Google is not signed in for this PHOENIX process', 'GOOGLE_REAUTH_REQUIRED')
    }
    for (const scope of required) {
      if (!current.scopes.has(scope)) {
        throw new AuthorizationError(`Google scope is not granted: ${scope}`, 'GOOGLE_SCOPE_DENIED')
      }
    }
    if (current.expiresAt > internals.now() + EXPIRY_SKEW_MS) return current
    return this.refresh(current, signal)
  }

  private refresh(current: GoogleGrant, signal?: AbortSignal): Promise<GoogleGrant> {
    if (this.refreshInFlight !== undefined) return this.refreshInFlight
    const clientId = this.spec.clientId
    const refreshToken = current.refreshToken
    if (clientId === undefined || refreshToken === undefined) {
      return Promise.reject(new AuthorizationError('Google session needs interactive authorization again', 'GOOGLE_REAUTH_REQUIRED'))
    }
    const running = this.refreshGrant(current, clientId, refreshToken, signal).finally(() => {
      if (this.refreshInFlight === running) this.refreshInFlight = undefined
    })
    this.refreshInFlight = running
    return running
  }

  private async refreshGrant(
    current: GoogleGrant,
    clientId: string,
    refreshToken: string,
    signal?: AbortSignal,
  ): Promise<GoogleGrant> {
    const response = await internals.fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: clientId, refresh_token: refreshToken, grant_type: 'refresh_token' }),
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) {
      throw new AuthorizationError(`Google token refresh failed with HTTP ${String(response.status)}`, 'GOOGLE_REFRESH_FAILED')
    }
    const token = await readTokenResponse(response)
    if (token.token_type.toLowerCase() !== 'bearer') {
      throw new AuthorizationError('Google returned an unsupported token type', 'GOOGLE_TOKEN_RESPONSE')
    }
    const next: GoogleGrant = {
      accessToken: token.access_token,
      ...(token.refresh_token === undefined
        ? (current.refreshToken === undefined ? {} : { refreshToken: current.refreshToken })
        : { refreshToken: token.refresh_token }),
      expiresAt: internals.now() + token.expires_in * 1000,
      scopes: token.scope === undefined ? current.scopes : parseGrantedScopes(token.scope),
    }
    this.grant = next
    return next
  }
}

/** Test seams for network, clock, and loopback I/O; production does not mutate them. */
export const internals: {
  fetch: typeof fetch
  now: () => number
  openLoopback: typeof openLoopback
} = {
  fetch,
  now: Date.now,
  openLoopback,
}
