/**
 * Credential-backed OAuth support for remote MCP servers.
 *
 * The model-facing MCP bridge never receives OAuth secrets. The owner-scoped
 * grant lives behind `ctx.credentials`; the human authorization ceremony is
 * exposed through `ctx.authorization`; and only this Host-side provider reads
 * refresh tokens or a configured OAuth client secret.
 *
 * @module
 */

import { randomBytes } from 'node:crypto'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import {
  auth,
  refreshAuthorization,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  credentialKey,
  credentialRef,
  type CredentialKey,
  type CredentialRecord,
} from '@deepseek-ai/dsh-credentials'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'

/** Configured OAuth owner for one Streamable HTTP MCP server. */
export interface McpOAuthConfig {
  /** Owner-local credential id, e.g. `google-gmail`. */
  credentialId: string
  /** Human-facing account/service label. */
  label?: string
  /** Pre-registered OAuth client id. This is public client metadata. */
  clientId: string
  /** Credential reference containing the OAuth client secret, when required. */
  clientSecretRef?: string
  /** Exact loopback callback URI registered with the authorization server. */
  redirectUrl: string
  /** Exact authorization-server issuer trusted to receive client credentials. */
  expectedIssuer: string
  /** Optional explicit OAuth scope; protected-resource metadata remains preferred. */
  scope?: string
  /** Maximum time the local callback listener waits for the browser flow. */
  authorizationTimeoutMs: number
}

/** Stored payload version owned exclusively by mcp-client. */
interface McpOAuthGrantPayload {
  version: 1
  tokens: OAuthTokens
  /** Absolute local expiry used to refresh under the credential-store lock. */
  expiresAt?: number
  discoveryState?: OAuthDiscoveryState
}

/** Callback accepted from the exact configured loopback route. */
interface AcceptedCallback {
  readonly params: URLSearchParams
  success(): void
  fail(): void
}

/** Publicly safe failure: never append provider response bodies or token values. */
export class McpOAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpOAuthError'
  }
}

/** Compare issuer identifiers with the one narrow trailing-slash tolerance. */
export function issuersMatch(left: string, right: string): boolean {
  const a = left.endsWith('/') ? left.slice(0, -1) : left
  const b = right.endsWith('/') ? right.slice(0, -1) : right
  return a === b
}

/**
 * Fetch used for every credential-bearing OAuth/MCP request. Redirects are a
 * credential exfiltration boundary and therefore fail closed.
 */
export const rejectRedirectFetch: FetchLike = (input, init) => {
  return fetch(input, { ...init, redirect: 'error' })
}

/** Parse and validate the fixed authorization issuer from configuration. */
function validateExpectedIssuer(raw: string): URL {
  let issuer: URL
  try { issuer = new URL(raw) } catch { throw new McpOAuthError('MCP OAuth expectedIssuer is not a valid URL') }
  if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash) {
    throw new McpOAuthError('MCP OAuth expectedIssuer must be a credential-free HTTPS URL')
  }
  return issuer
}

/** Parse the exact local redirect. A fixed IPv4 loopback URI avoids DNS/host ambiguity. */
function validateRedirect(raw: string): URL {
  let redirect: URL
  try { redirect = new URL(raw) } catch { throw new McpOAuthError('MCP OAuth redirectUrl is not a valid URL') }
  if (
    redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1' || redirect.port === '' ||
    redirect.username || redirect.password || redirect.search || redirect.hash
  ) {
    throw new McpOAuthError('MCP OAuth redirectUrl must be an exact http://127.0.0.1:<port>/... loopback URL')
  }
  return redirect
}

/** Read one owner record without allowing another record kind/shape to masquerade as OAuth. */
function parseGrant(record: CredentialRecord | undefined): McpOAuthGrantPayload | undefined {
  if (record === undefined) return undefined
  if (record.kind !== 'grant' || typeof record.payload !== 'object' || record.payload === null || Array.isArray(record.payload)) {
    throw new McpOAuthError('MCP OAuth credential record has an incompatible format; reconnect this account')
  }
  const payload = record.payload as Partial<McpOAuthGrantPayload>
  if (payload.version !== 1 || typeof payload.tokens !== 'object' || payload.tokens === null) {
    throw new McpOAuthError('MCP OAuth credential record has an incompatible format; reconnect this account')
  }
  const accessToken = (payload.tokens as Partial<OAuthTokens>).access_token
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new McpOAuthError('MCP OAuth credential record has no usable access token; reconnect this account')
  }
  return payload as McpOAuthGrantPayload
}

/** Keep refresh material private even from the SDK's ordinary resource-token read. */
function resourceTokens(tokens: OAuthTokens): OAuthTokens {
  const { refresh_token: _refreshToken, ...visible } = tokens
  return visible as OAuthTokens
}

/** Derive an absolute expiry from a freshly issued token response. */
function tokenExpiry(tokens: OAuthTokens, now = Date.now()): number | undefined {
  if (typeof tokens.expires_in !== 'number' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) return undefined
  return now + tokens.expires_in * 1000
}

/**
 * Host-side provider that binds one MCP resource URL to one expected OAuth
 * issuer and one owner-scoped credential record.
 */
export class McpOAuthController implements OAuthClientProvider {
  readonly key: CredentialKey
  readonly redirectUrl: URL
  readonly clientMetadata: OAuthClientMetadata

  private readonly expectedIssuer: URL
  private readonly clientSecretRef: ReturnType<typeof credentialRef> | undefined
  private activeSession: AuthorizationSession | undefined
  private activeState: string | undefined
  private verifier: string | undefined
  private pendingDiscovery: OAuthDiscoveryState | undefined
  private issuerValidated = false
  private onAuthorized: (() => Promise<void> | void) | undefined

  constructor(
    private readonly ctx: Context,
    private readonly serverUrl: URL,
    readonly config: McpOAuthConfig,
  ) {
    this.key = credentialKey('mcp-client', config.credentialId)
    this.redirectUrl = validateRedirect(config.redirectUrl)
    this.expectedIssuer = validateExpectedIssuer(config.expectedIssuer)
    this.clientSecretRef = config.clientSecretRef === undefined ? undefined : credentialRef(config.clientSecretRef)
    this.clientMetadata = {
      client_name: `PHOENIX ${config.label ?? config.credentialId}`,
      redirect_uris: [this.redirectUrl.toString()],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      ...config.scope === undefined ? {} : { scope: config.scope },
    }
  }

  /** Called by the plugin lifecycle after a newly authorized grant is durable. */
  setAuthorizedHandler(handler: () => Promise<void> | void): void {
    this.onAuthorized = handler
  }

  /** Whether a complete owner grant is already durable. */
  async hasTokens(): Promise<boolean> {
    return parseGrant(await this.ctx.credentials.readRecord(this.key)) !== undefined
  }

  /**
   * Only return the public client id until discovery proves the configured
   * issuer. A secret is resolved at the last responsible moment and only after
   * that binding has succeeded.
   */
  async clientInformation(): Promise<OAuthClientInformationMixed> {
    if (!this.issuerValidated) {
      throw new McpOAuthError('MCP OAuth issuer was not validated before client credentials were requested')
    }
    if (this.clientSecretRef === undefined) return { client_id: this.config.clientId }
    const resolved = await this.ctx.credentials.resolve(this.clientSecretRef)
    if (resolved === undefined) {
      throw new McpOAuthError(`MCP OAuth client secret reference ${this.config.clientSecretRef} is not configured`)
    }
    return { client_id: this.config.clientId, client_secret: resolved.value }
  }

  /** One unpredictable state value per human authorization attempt. */
  state(): string {
    if (this.activeState === undefined) throw new McpOAuthError('MCP OAuth authorization state is not active')
    return this.activeState
  }

  /** Route the authorization URL to the human surface, never to model context. */
  redirectToAuthorization(authorizationUrl: URL): void {
    const session = this.activeSession
    if (session === undefined) throw new McpOAuthError('MCP OAuth authorization is required; reconnect the account from Settings')
    if (authorizationUrl.protocol !== 'https:' || authorizationUrl.origin !== this.expectedIssuer.origin) {
      throw new McpOAuthError('MCP OAuth authorization endpoint does not belong to the configured issuer')
    }
    session.notify({
      message: `Sign in to ${this.config.label ?? this.config.credentialId} in your browser`,
      url: authorizationUrl.toString(),
    })
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier
  }

  codeVerifier(): string {
    if (this.verifier === undefined) throw new McpOAuthError('MCP OAuth PKCE verifier is unavailable; restart authorization')
    return this.verifier
  }

  /** Validate discovery before any secret-bearing client information can be returned. */
  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    this.validateDiscoveryState(state)
    this.pendingDiscovery = state

    // Updating discovery for an already-authorized account is safe to persist.
    // During first authorization there is deliberately no partial grant write:
    // the authorization seam must only observe a commit once tokens exist.
    const current = await this.ctx.credentials.readRecord(this.key)
    if (current === undefined) return
    await this.ctx.credentials.modifyRecord(this.key, (latest) => {
      const payload = parseGrant(latest)
      if (payload === undefined) return undefined
      return Promise.resolve({ kind: 'grant', payload: { ...payload, discoveryState: state } })
    })
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    if (this.pendingDiscovery !== undefined) {
      this.validateDiscoveryState(this.pendingDiscovery)
      return this.pendingDiscovery
    }
    const payload = parseGrant(await this.ctx.credentials.readRecord(this.key))
    if (payload?.discoveryState === undefined) return undefined
    this.validateDiscoveryState(payload.discoveryState)
    return payload.discoveryState
  }

  /**
   * Per-request token read. Normal expiry refresh is performed inside
   * `modifyRecord`, so the credential-store lock covers the network round trip
   * and rotating refresh tokens cannot race across Host processes.
   */
  async tokens(): Promise<OAuthTokens | undefined> {
    const first = parseGrant(await this.ctx.credentials.readRecord(this.key))
    if (first === undefined) return undefined
    const now = Date.now()
    const shouldRefresh = first.expiresAt !== undefined && first.expiresAt <= now + 60_000 && first.tokens.refresh_token !== undefined
    if (!shouldRefresh) return resourceTokens(first.tokens)

    const updated = await this.ctx.credentials.modifyRecord(this.key, async (current) => {
      const payload = parseGrant(current)
      if (payload === undefined) return undefined
      const stillNeedsRefresh = payload.expiresAt !== undefined && payload.expiresAt <= Date.now() + 60_000
      if (!stillNeedsRefresh || payload.tokens.refresh_token === undefined) return current
      if (payload.discoveryState === undefined) {
        throw new McpOAuthError('MCP OAuth discovery state is unavailable; reconnect this account')
      }
      this.validateDiscoveryState(payload.discoveryState)
      const clientInformation = await this.clientInformation()
      let refreshed: OAuthTokens
      try {
        refreshed = await refreshAuthorization(payload.discoveryState.authorizationServerUrl, {
          metadata: payload.discoveryState.authorizationServerMetadata,
          clientInformation,
          refreshToken: payload.tokens.refresh_token,
          fetchFn: rejectRedirectFetch,
        })
      } catch {
        throw new McpOAuthError('MCP OAuth token refresh failed; reconnect this account')
      }
      const merged: OAuthTokens = refreshed.refresh_token === undefined
        ? { ...refreshed, refresh_token: payload.tokens.refresh_token }
        : refreshed
      return {
        kind: 'grant',
        payload: {
          ...payload,
          tokens: merged,
          expiresAt: tokenExpiry(merged),
        },
      }
    })
    return resourceTokens((parseGrant(updated) as McpOAuthGrantPayload).tokens)
  }

  /** Initial code exchange lands the complete token set atomically in the owner record. */
  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.ctx.credentials.modifyRecord(this.key, async (current) => {
      const previous = current === undefined ? undefined : parseGrant(current)
      const merged: OAuthTokens = tokens.refresh_token === undefined && previous?.tokens.refresh_token !== undefined
        ? { ...tokens, refresh_token: previous.tokens.refresh_token }
        : tokens
      return {
        kind: 'grant',
        payload: {
          version: 1,
          tokens: merged,
          expiresAt: tokenExpiry(merged),
          ...this.pendingDiscovery !== undefined
            ? { discoveryState: this.pendingDiscovery }
            : previous?.discoveryState !== undefined
              ? { discoveryState: previous.discoveryState }
              : {},
        },
      }
    })
  }

  /** SDK recovery hooks never expose the removed material to callers. */
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    if (scope === 'verifier') {
      this.verifier = undefined
      return
    }
    if (scope === 'discovery') {
      this.pendingDiscovery = undefined
      this.issuerValidated = false
      await this.ctx.credentials.modifyRecord(this.key, (current) => {
        const payload = current === undefined ? undefined : parseGrant(current)
        if (payload === undefined) return undefined
        const { discoveryState: _discoveryState, ...rest } = payload
        return Promise.resolve({ kind: 'grant', payload: rest })
      })
      return
    }
    if (scope === 'tokens' || scope === 'all') {
      this.pendingDiscovery = undefined
      this.issuerValidated = false
      this.verifier = undefined
      await this.ctx.credentials.deleteRecord(this.key)
    }
  }

  /**
   * Run the human browser ceremony through the neutral authorization seam.
   * Provider-controlled error text is deliberately collapsed to stable local
   * messages before it can reach UI, logs, or model-visible tool failures.
   */
  async authorize(session: AuthorizationSession): Promise<void> {
    this.activeSession = session
    this.activeState = randomBytes(32).toString('base64url')
    this.verifier = undefined
    this.pendingDiscovery = undefined
    this.issuerValidated = false
    let callbackServer: Server | undefined
    try {
      const callback = await listenForCallback(
        this.redirectUrl,
        this.activeState,
        this.expectedIssuer.toString(),
        session.signal,
        this.config.authorizationTimeoutMs,
      )
      callbackServer = callback.server

      let first: Awaited<ReturnType<typeof auth>>
      try {
        first = await auth(this, {
          serverUrl: this.serverUrl,
          ...this.config.scope === undefined ? {} : { scope: this.config.scope },
          fetchFn: rejectRedirectFetch,
        })
      } catch (error: unknown) {
        if (error instanceof McpOAuthError) throw error
        throw new McpOAuthError('MCP OAuth authorization could not be started')
      }

      if (first === 'AUTHORIZED') {
        if (!await this.hasTokens()) throw new McpOAuthError('MCP OAuth authorization completed without a durable grant')
        await this.notifyAuthorized()
        callback.close()
        return
      }

      const accepted = await callback.result
      const code = accepted.params.get('code')
      if (code === null || code.length === 0) {
        accepted.fail()
        throw new McpOAuthError('MCP OAuth authorization was declined or returned no code')
      }

      let completed: Awaited<ReturnType<typeof auth>>
      try {
        completed = await auth(this, {
          serverUrl: this.serverUrl,
          authorizationCode: code,
          ...this.config.scope === undefined ? {} : { scope: this.config.scope },
          fetchFn: rejectRedirectFetch,
        })
      } catch (error: unknown) {
        accepted.fail()
        if (error instanceof McpOAuthError) throw error
        throw new McpOAuthError('MCP OAuth authorization failed during code exchange')
      }
      if (completed !== 'AUTHORIZED' || !await this.hasTokens()) {
        accepted.fail()
        throw new McpOAuthError('MCP OAuth authorization did not produce a durable grant')
      }
      accepted.success()
      await this.notifyAuthorized()
    } finally {
      await closeServer(callbackServer)
      this.activeSession = undefined
      this.activeState = undefined
      this.verifier = undefined
    }
  }

  private async notifyAuthorized(): Promise<void> {
    try { await this.onAuthorized?.() } catch {
      // The grant is already valid. A transient MCP reconnect failure must not
      // rewrite authorization success into a credential failure.
      this.ctx.logger.warn(`mcp-client(${this.config.credentialId}): authorized; MCP connection will retry separately`)
    }
  }

  /** Issuer pin that runs on fresh and restored discovery state. */
  private validateDiscoveryState(state: OAuthDiscoveryState): void {
    const issuer = state.authorizationServerMetadata?.issuer ?? state.authorizationServerUrl
    if (!issuersMatch(String(issuer), this.expectedIssuer.toString())) {
      throw new McpOAuthError('MCP OAuth discovery returned an unexpected authorization issuer')
    }
    const authEndpoint = state.authorizationServerMetadata?.authorization_endpoint
    const tokenEndpoint = state.authorizationServerMetadata?.token_endpoint
    if (authEndpoint !== undefined) {
      const parsed = new URL(authEndpoint)
      if (parsed.protocol !== 'https:' || parsed.origin !== this.expectedIssuer.origin) {
        throw new McpOAuthError('MCP OAuth authorization endpoint does not belong to the configured issuer')
      }
    }
    if (tokenEndpoint !== undefined) {
      const parsed = new URL(tokenEndpoint)
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
        throw new McpOAuthError('MCP OAuth token endpoint is not a credential-free HTTPS URL')
      }
    }
    this.issuerValidated = true
  }
}

/** Exact callback listener. Invalid state/issuer requests are rejected but do not poison the legitimate flow. */
async function listenForCallback(
  redirect: URL,
  expectedState: string,
  expectedIssuer: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<{ server: Server; result: Promise<AcceptedCallback>; close(): void }> {
  const result = Promise.withResolvers<AcceptedCallback>()
  let settled = false
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url === undefined) {
      answer(response, 404, 'Not found')
      return
    }
    const received = new URL(request.url, redirect.origin)
    if (received.pathname !== redirect.pathname) {
      answer(response, 404, 'Not found')
      return
    }
    const state = received.searchParams.get('state')
    if (state !== expectedState) {
      answer(response, 400, 'Authorization callback rejected')
      return
    }
    const iss = received.searchParams.get('iss')
    if (iss !== null && !issuersMatch(iss, expectedIssuer)) {
      answer(response, 400, 'Authorization callback rejected')
      return
    }
    if (settled) {
      answer(response, 409, 'Authorization callback already received')
      return
    }
    settled = true
    result.resolve({
      params: received.searchParams,
      success: () => answer(response, 200, 'PHOENIX authorization complete. You can close this tab.'),
      fail: () => answer(response, 400, 'PHOENIX authorization could not be completed. Return to PHOENIX and try again.'),
    })
  })

  const abort = (): void => {
    if (!settled) {
      settled = true
      result.reject(new McpOAuthError('MCP OAuth authorization was cancelled'))
    }
    server.close()
  }
  signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => {
    if (!settled) {
      settled = true
      result.reject(new McpOAuthError('MCP OAuth authorization timed out'))
    }
    server.close()
  }, timeoutMs)
  timer.unref()

  try {
    await new Promise<void>((resolve, reject) => {
      const port = Number(redirect.port)
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
  } catch {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    throw new McpOAuthError('MCP OAuth loopback callback could not start; the configured port may already be in use')
  }

  return {
    server,
    result: result.promise.finally(() => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
    }),
    close: () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      server.close()
    },
  }
}

function answer(response: ServerResponse, status: number, body: string): void {
  if (response.headersSent || response.destroyed) return
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(body)
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (server === undefined || !server.listening) return
  await new Promise<void>(resolve => server.close(() => resolve()))
}

/** Narrowly exported for invariant-focused tests. */
export function callbackPort(controller: McpOAuthController): number {
  return Number((controller.redirectUrl as URL).port) || ((controller.redirectUrl as URL).port === '' ? 0 : (controller.redirectUrl as unknown as AddressInfo).port)
}
