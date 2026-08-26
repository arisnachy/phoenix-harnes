/**
 * Host-only Google Workspace OAuth broker.
 *
 * The browser ceremony uses Google's Desktop/installed-application flow with a
 * loopback redirect, PKCE S256, and state. Access and refresh tokens remain
 * private fields of this Host Service and are never written to the file-backed
 * credential provider. The credential store receives only a secret-free marker
 * so the neutral authorization seam can observe a completed human login.
 *
 * API callers choose a fixed Google service rather than supplying an arbitrary
 * URL or OAuth scope. A PHOENIX restart intentionally requires Google login
 * again until a credential backend isolated from same-UID tool processes exists.
 *
 * @module @deepseek-ai/dsh-authorization/google
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Service, type Context } from '@deepseek-ai/cordis'
import { credentialKey, type CredentialKey } from '@deepseek-ai/dsh-credentials'
import { AuthorizationError, type AuthorizationSession, type AuthorizationTelemetry } from './index.ts'

/** Secret-free durable marker for the process-local Google account. */
export const GOOGLE_ACCOUNT_KEY: CredentialKey = credentialKey('authorization-google', 'account')

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
const LOOPBACK_HOST = '127.0.0.1'
const CALLBACK_PATH = '/oauth2/callback'
const EXPIRY_SKEW_MS = 60_000

/** Deployment configuration. */
export interface Config {
  /** Google Desktop OAuth client id. It identifies the app; it is not a user secret. */
  clientId?: string
  /** Consent set offered to the human. Installed apps do not support incremental authorization. */
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
  scopes: readonly string[]
}

interface TokenResponse {
  access_token: string
  expires_in: number
  token_type: string
  refresh_token?: string
  scope?: string
}

/** Google Workspace surfaces whose destination and scope are broker-owned. */
export type GoogleWorkspaceService =
  | 'gmail'
  | 'calendar'
  | 'drive'
  | 'docs'
  | 'sheets'
  | 'slides'
  | 'contacts'

interface ServiceSpec {
  base: string
  uploadBase?: string
  scope: string
}

const SERVICES: Readonly<Record<GoogleWorkspaceService, ServiceSpec>> = {
  gmail: {
    base: 'https://gmail.googleapis.com/gmail/v1/',
    uploadBase: 'https://gmail.googleapis.com/upload/gmail/v1/',
    scope: 'https://www.googleapis.com/auth/gmail.modify',
  },
  calendar: {
    base: 'https://www.googleapis.com/calendar/v3/',
    scope: 'https://www.googleapis.com/auth/calendar',
  },
  drive: {
    base: 'https://www.googleapis.com/drive/v3/',
    uploadBase: 'https://www.googleapis.com/upload/drive/v3/',
    scope: 'https://www.googleapis.com/auth/drive',
  },
  docs: {
    base: 'https://docs.googleapis.com/v1/',
    scope: 'https://www.googleapis.com/auth/documents',
  },
  sheets: {
    base: 'https://sheets.googleapis.com/v4/',
    scope: 'https://www.googleapis.com/auth/spreadsheets',
  },
  slides: {
    base: 'https://slides.googleapis.com/v1/',
    scope: 'https://www.googleapis.com/auth/presentations',
  },
  contacts: {
    base: 'https://people.googleapis.com/v1/',
    scope: 'https://www.googleapis.com/auth/contacts',
  },
}

/** One Host-side Google API operation through the broker. */
export interface GoogleApiRequest {
  /** Fixed Google service; determines both destination root and required OAuth scope. */
  service: GoogleWorkspaceService
  /** Relative API path below that service root, including an optional query string. */
  path: string
  /** HTTP method; defaults to GET. */
  method?: string
  /** Caller headers; credential and cookie headers are forbidden. */
  headers?: Readonly<Record<string, string>>
  /** Optional body forwarded unchanged. */
  body?: BodyInit | null
  /** Use the service's fixed upload root where one exists. */
  upload?: boolean
  /** Optional cancellation signal. */
  signal?: AbortSignal
}

/** Secret-free Google API result. Response headers are intentionally not forwarded wholesale. */
export interface GoogleApiResponse {
  status: number
  ok: boolean
  contentType?: string
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

/** Resolve broker configuration without inventing scopes or a deployment identity. */
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

function parseGrantedScopes(value: string | undefined): readonly string[] {
  if (!nonEmpty(value)) {
    throw new AuthorizationError(
      'Google did not report the scopes actually granted; refusing to assume consent',
      'GOOGLE_SCOPE_UNVERIFIED',
    )
  }
  return [...new Set(value.trim().split(/\s+/u))]
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

function serviceUrl(request: GoogleApiRequest): { url: URL; scope: string } {
  const spec = SERVICES[request.service]
  if (spec === undefined) {
    throw new AuthorizationError('Google broker service is not allowed', 'GOOGLE_SERVICE_DENIED')
  }
  const rawPath = request.path
  if (!nonEmpty(rawPath)
    || rawPath.startsWith('/')
    || rawPath.includes('\\')
    || /^[a-z][a-z0-9+.-]*:/iu.test(rawPath)) {
    throw new AuthorizationError('Google broker path must be relative to the selected service', 'GOOGLE_PATH_DENIED')
  }
  const baseText = request.upload === true ? spec.uploadBase : spec.base
  if (baseText === undefined) {
    throw new AuthorizationError('The selected Google service has no upload endpoint', 'GOOGLE_PATH_DENIED')
  }
  const base = new URL(baseText)
  const url = new URL(rawPath, base)
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.hash !== '') {
    throw new AuthorizationError('Google broker path escaped the selected service boundary', 'GOOGLE_PATH_DENIED')
  }
  return { url, scope: spec.scope }
}

function callerHeaders(headers: Readonly<Record<string, string>> | undefined): Headers {
  const result = new Headers()
  for (const [name, value] of Object.entries(headers ?? {})) {
    const lower = name.toLowerCase()
    if (lower === 'authorization'
      || lower === 'proxy-authorization'
      || lower === 'cookie'
      || lower === 'set-cookie') {
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
    redirect: 'error',
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
      response.setHeader('x-content-type-options', 'nosniff')
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
    prompt: 'consent',
  })) url.searchParams.set(key, value)
  return url.toString()
}

/** Google Host broker. OAuth material never leaves this service instance. */
export default class GoogleApiBroker extends Service {
  static inject = ['authorization', 'credentials']

  private readonly spec: ResolvedSpec
  private readonly startupCleanup: Promise<void>
  private grant?: GoogleGrant
  private refreshInFlight?: Promise<GoogleGrant>

  constructor(ctx: Context, config: Config) {
    super(ctx, 'googleApi')
    this.spec = resolveGoogleSpec(config)
    this.startupCleanup = this.purgeStaleRecord()
    // Cleanup starts at construction so a secret grant or marker left by an
    // earlier process cannot be mistaken for this process's live session.
    // Attach a rejection handler immediately to avoid an unhandled rejection;
    // every public operation still awaits the original promise and fails loud.
    void this.startupCleanup.catch(() => {})
    ctx.effect(() => ctx.authorization.registerFlow({
      key: GOOGLE_ACCOUNT_KEY,
      label: 'Google Workspace',
      methods: [{ id: 'oauth', label: 'Sign in with Google' }],
      inspect: () => this.inspect(),
      run: session => this.authorize(session),
    }))
  }

  /** Secret-free telemetry exists only while this process owns a live grant. */
  async inspect(): Promise<AuthorizationTelemetry | undefined> {
    await this.startupCleanup
    return this.grant === undefined
      ? undefined
      : { kind: 'account', provider: 'google', accountType: 'oauth' }
  }

  /** Execute one request inside a fixed Google service boundary. */
  async request(request: GoogleApiRequest): Promise<GoogleApiResponse> {
    const destination = serviceUrl(request)
    const headers = callerHeaders(request.headers)
    const grant = await this.usableGrant(destination.scope, request.signal)
    headers.set('authorization', `Bearer ${grant.accessToken}`)
    const response = await internals.fetch(destination.url, apiFetchInit(request, headers))
    const contentType = response.headers.get('content-type') ?? undefined
    const body = await response.text()
    return {
      status: response.status,
      ok: response.ok,
      ...(contentType === undefined ? {} : { contentType }),
      body,
    }
  }

  /** Clear the process grant and secret-free marker even when provider revocation fails. */
  async disconnect(): Promise<{ revoked: boolean }> {
    await this.startupCleanup
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
          redirect: 'error',
        })).ok
      } catch {
        revoked = false
      }
    }
    await this.ctx.credentials.deleteRecord(GOOGLE_ACCOUNT_KEY)
    return { revoked }
  }

  private async authorize(session: AuthorizationSession): Promise<void> {
    await this.startupCleanup
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
        message: 'Continue with Google in your browser. PHOENIX keeps OAuth tokens inside the Host process.',
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
        redirect: 'error',
      })
      if (!response.ok) {
        throw new AuthorizationError(`Google token exchange failed with HTTP ${String(response.status)}`, 'GOOGLE_TOKEN_EXCHANGE')
      }
      const token = await readTokenResponse(response)
      if (token.token_type.toLowerCase() !== 'bearer') {
        throw new AuthorizationError('Google returned an unsupported token type', 'GOOGLE_TOKEN_RESPONSE')
      }
      const next: GoogleGrant = {
        accessToken: token.access_token,
        ...(token.refresh_token === undefined ? {} : { refreshToken: token.refresh_token }),
        expiresAt: internals.now() + token.expires_in * 1000,
        scopes: parseGrantedScopes(token.scope),
      }
      await this.ctx.credentials.modifyRecord(GOOGLE_ACCOUNT_KEY, () => Promise.resolve({ kind: 'api-key' }))
      this.grant = next
    } finally {
      await receiver.close()
    }
  }

  private async usableGrant(requiredScope: string, signal?: AbortSignal): Promise<GoogleGrant> {
    await this.startupCleanup
    const current = this.grant
    if (current === undefined) {
      throw new AuthorizationError('Google is not signed in for this PHOENIX process', 'GOOGLE_REAUTH_REQUIRED')
    }
    if (!current.scopes.includes(requiredScope)) {
      throw new AuthorizationError('Google permission for this capability was not granted', 'GOOGLE_SCOPE_DENIED')
    }
    if (current.expiresAt > internals.now() + EXPIRY_SKEW_MS) return current
    return this.refresh(current, requiredScope, signal)
  }

  private refresh(current: GoogleGrant, requiredScope: string, signal?: AbortSignal): Promise<GoogleGrant> {
    const checkScope = (next: GoogleGrant): GoogleGrant => {
      if (!next.scopes.includes(requiredScope)) {
        throw new AuthorizationError('Google permission for this capability was not granted', 'GOOGLE_SCOPE_DENIED')
      }
      return next
    }
    if (this.refreshInFlight !== undefined) return this.refreshInFlight.then(checkScope)
    const clientId = this.spec.clientId
    const refreshToken = current.refreshToken
    if (clientId === undefined || refreshToken === undefined) {
      return Promise.reject(new AuthorizationError(
        'Google session needs interactive authorization again', 'GOOGLE_REAUTH_REQUIRED'))
    }
    const running = this.refreshGrant(current, clientId, refreshToken, signal).finally(() => {
      if (this.refreshInFlight === running) this.refreshInFlight = undefined
    })
    this.refreshInFlight = running
    return running.then(checkScope)
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
      redirect: 'error',
    })
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        this.grant = undefined
        await this.ctx.credentials.deleteRecord(GOOGLE_ACCOUNT_KEY)
        throw new AuthorizationError('Google authorization is no longer valid; reconnect Google', 'GOOGLE_REAUTH_REQUIRED')
      }
      throw new AuthorizationError(`Google token refresh failed with HTTP ${String(response.status)}`, 'GOOGLE_REFRESH_FAILED')
    }
    const token = await readTokenResponse(response)
    if (token.token_type.toLowerCase() !== 'bearer') {
      throw new AuthorizationError('Google returned an unsupported token type', 'GOOGLE_TOKEN_RESPONSE')
    }
    const next: GoogleGrant = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? current.refreshToken,
      expiresAt: internals.now() + token.expires_in * 1000,
      scopes: token.scope === undefined ? current.scopes : parseGrantedScopes(token.scope),
    }
    this.grant = next
    return next
  }

  /** Remove any Google credential record that predates this process-local broker instance. */
  private async purgeStaleRecord(): Promise<void> {
    const info = await this.ctx.credentials.describeRecord(GOOGLE_ACCOUNT_KEY)
    if (info.configured) await this.ctx.credentials.deleteRecord(GOOGLE_ACCOUNT_KEY)
  }
}

/** Test seams for network, clock, and loopback I/O; production never mutates them. */
export const internals: {
  fetch: typeof fetch
  now: () => number
  openLoopback: typeof openLoopback
} = {
  fetch,
  now: Date.now,
  openLoopback,
}
