/**
 * Host-only Google OAuth broker. The authorization flow uses Google's installed-
 * application Authorization Code flow with loopback redirect, PKCE S256, and
 * state. OAuth tokens live only in this Service instance: the credential store
 * receives a marker after login so configuration surfaces can report presence,
 * while callers use {@link GoogleApiBroker.request} and never receive a Bearer
 * token or refresh token.
 *
 * @module @deepseek-ai/dsh-authorization/google
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context, Service } from '@deepseek-ai/cordis'
import { credentialKey, type CredentialKey } from '@deepseek-ai/dsh-credentials'
import { AuthorizationError, type AuthorizationSession, type AuthorizationTelemetry } from './index.ts'

/** Durable, secret-free marker for the Google account owned by this broker. */
export const GOOGLE_ACCOUNT_KEY: CredentialKey = credentialKey('authorization-google', 'account')

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
const LOOPBACK_HOST = '127.0.0.1'
const CALLBACK_PATH = '/oauth2/callback'
const EXPIRY_SKEW_MS = 60_000

/** Deployment configuration. `clientId` may be omitted so the flow stays discoverable and reports the setup action when invoked. */
export interface Config {
  /** Google OAuth Desktop client id. Never a password or user credential. */
  clientId?: string
  /** OAuth scopes the human may approve. The broker later fails closed when a caller asks for a scope absent from the grant. */
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

/** One Google API request made by a Host plugin through the broker. */
export interface GoogleApiRequest {
  /** HTTPS URL under `*.googleapis.com` or `www.googleapis.com`; OAuth endpoints are intentionally excluded. */
  url: string
  /** HTTP method; defaults to GET. */
  method?: string
  /** Scopes the operation needs. Every entry must have been explicitly granted. */
  requiredScopes: readonly string[]
  /** Caller headers. Authentication and cookie headers are rejected because the broker owns credentials. */
  headers?: Readonly<Record<string, string>>
  /** Optional request body forwarded unchanged. */
  body?: BodyInit | null
  /** Optional cancellation signal. */
  signal?: AbortSignal
}

/** Secret-free HTTP result. Response headers are intentionally not forwarded. */
export interface GoogleApiResponse {
  /** HTTP status from the Google API. */
  status: number
  /** Fetch success flag for the HTTP status. */
  ok: boolean
  /** Response media type when Google supplied one. */
  contentType?: string
  /** Response body text. */
  body: string
}

interface LoopbackReceiver {
  redirectUri: string
  code: Promise<string>
  close(): Promise<void>
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/** Resolve and validate broker configuration without inventing deployment scopes. */
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
  return { clientId, scopes }
}

function base64url(value: Buffer): string {
  return value.toString('base64url')
}

function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48))
  const challenge = base64url(createHash('sha256').update(verifier, 'ascii').digest())
  return { verifier, challenge }
}

function grantedScopes(value: string | undefined): ReadonlySet<string> {
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
  const candidate = value as Partial<TokenResponse>
  if (!nonEmpty(candidate.access_token)
    || typeof candidate.expires_in !== 'number'
    || !Number.isFinite(candidate.expires_in)
    || candidate.expires_in <= 0
    || !nonEmpty(candidate.token_type)) {
    throw new AuthorizationError('Google returned an incomplete token response', 'GOOGLE_TOKEN_RESPONSE')
  }
  if (candidate.refresh_token !== undefined && !nonEmpty(candidate.refresh_token)) {
    throw new AuthorizationError('Google returned an invalid refresh credential', 'GOOGLE_TOKEN_RESPONSE')
  }
  if (candidate.scope !== undefined && typeof candidate.scope !== 'string') {
    throw new AuthorizationError('Google returned an invalid scope list', 'GOOGLE_TOKEN_RESPONSE')
  }
  return candidate as TokenResponse
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new AuthorizationError('Google returned a non-JSON token response', 'GOOGLE_TOKEN_RESPONSE')
  }
}

function tokenBody(fields: Readonly<Record<string, string>>): URLSearchParams {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(fields)) body.set(key, value)
  return body
}

function isAllowedApiUrl(url: URL): boolean {
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return false
  if (url.hostname === 'www.googleapis.com') return true
  if (!url.hostname.endsWith('.googleapis.com')) return false
  return url.hostname !== 'oauth2.googleapis.com'
}

function assertCallerHeaders(headers: Readonly<Record<string, string>> | undefined): Headers {
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
    const providerError = callback.searchParams.get('error')
    if (providerError !== null) {
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

function authorizationUrl(spec: ResolvedSpec, redirectUri: string, state: string, challenge: string): string {
  if (spec.clientId === undefined) {
    throw new AuthorizationError(
      'Google OAuth is not configured. Set PHOENIX_GOOGLE_OAUTH_CLIENT_ID to a Google Desktop OAuth client id and restart PHOENIX.',
      'GOOGLE_CLIENT_UNCONFIGURED',
    )
  }
  const url = new URL(GOOGLE_AUTH_ENDPOINT)
  url.searchParams.set('client_id', spec.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', spec.scopes.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('prompt', 'consent')
  return url.toString()
}

/**
 * Google host broker. Its token members are private and no method returns them;
 * API calls inject Authorization only immediately before `fetch`.
 */
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

  /** Secret-free account telemetry for Settings and authorization surfaces. */
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
    const required = new Set(request.requiredScopes)
    if (required.size !== request.requiredScopes.length || [...required].some(scope => !nonEmpty(scope))) {
      throw new AuthorizationError('Google broker requiredScopes must be unique non-empty strings', 'GOOGLE_SCOPE_INVALID')
    }
    const grant = await this.usableGrant(required, request.signal)
    const headers = assertCallerHeaders(request.headers)
    headers.set('authorization', `Bearer ${grant.accessToken}`)
    const response = await internals.fetch(url, {
      method: request.method ?? 'GET',
      headers,
      body: request.body,
      signal: request.signal,
    })
    const contentType = response.headers.get('content-type') ?? undefined
    const body = await response.text()
    return { status: response.status, ok: response.ok, ...(contentType === undefined ? {} : { contentType }), body }
  }

  /**
   * Clear this process's Google session and durable marker, attempting provider revocation first.
   * @returns whether Google acknowledged revocation; local cleanup always completes.
   */
  async disconnect(): Promise<{ revoked: boolean }> {
    const grant = this.grant
    this.grant = undefined
    this.refreshInFlight = undefined
    let revoked = grant === undefined
    if (grant !== undefined) {
      const token = grant.refreshToken ?? grant.accessToken
      try {
        const response = await internals.fetch(GOOGLE_REVOKE_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: tokenBody({ token }),
        })
        revoked = response.ok
      } catch {
        revoked = false
      }
    }
    await this.ctx.credentials.deleteRecord(GOOGLE_ACCOUNT_KEY)
    return { revoked }
  }

  private async authorize(session: AuthorizationSession): Promise<void> {
    if (this.spec.clientId === undefined) {
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
        url: authorizationUrl(this.spec, receiver.redirectUri, state, pkce.challenge),
      })
      const code = await receiver.code
      const response = await internals.fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: tokenBody({
          client_id: this.spec.clientId,
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
      const token = parseTokenResponse(await parseJsonResponse(response))
      if (token.token_type.toLowerCase() !== 'bearer') {
        throw new AuthorizationError('Google returned an unsupported token type', 'GOOGLE_TOKEN_RESPONSE')
      }
      const scopes = grantedScopes(token.scope)
      const missing = this.spec.scopes.filter(scope => !scopes.has(scope))
      if (missing.length !== 0) {
        throw new AuthorizationError('Google did not grant every configured scope; related capabilities remain disconnected', 'GOOGLE_SCOPE_PARTIAL')
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
    if (current.refreshToken === undefined || this.spec.clientId === undefined) {
      return Promise.reject(new AuthorizationError('Google session needs interactive authorization again', 'GOOGLE_REAUTH_REQUIRED'))
    }
    const running = this.refreshGrant(current, signal).finally(() => {
      if (this.refreshInFlight === running) this.refreshInFlight = undefined
    })
    this.refreshInFlight = running
    return running
  }

  private async refreshGrant(current: GoogleGrant, signal?: AbortSignal): Promise<GoogleGrant> {
    const response = await internals.fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: tokenBody({
        client_id: this.spec.clientId as string,
        refresh_token: current.refreshToken as string,
        grant_type: 'refresh_token',
      }),
      signal,
    })
    if (!response.ok) {
      throw new AuthorizationError(`Google token refresh failed with HTTP ${String(response.status)}`, 'GOOGLE_REFRESH_FAILED')
    }
    const token = parseTokenResponse(await parseJsonResponse(response))
    if (token.token_type.toLowerCase() !== 'bearer') {
      throw new AuthorizationError('Google returned an unsupported token type', 'GOOGLE_TOKEN_RESPONSE')
    }
    const next: GoogleGrant = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? current.refreshToken,
      expiresAt: internals.now() + token.expires_in * 1000,
      scopes: token.scope === undefined ? current.scopes : grantedScopes(token.scope),
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
