import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { auth } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { credentialKey, type CredentialKey, type CredentialProvider } from '@phoenix-ai/dsh-credentials'
import type { AuthorizationSession } from '@phoenix-ai/dsh-authorization'

/** JSON-safe OAuth state kept by the host-side credential owner. */
export interface McpOAuthState {
  clientInformation?: OAuthClientInformationMixed
  tokens?: OAuthTokens
  codeVerifier?: string
  discoveryState?: OAuthDiscoveryState
}

/** Narrow persistence seam; implementations must keep values host-only. */
export interface McpOAuthStateStore {
  read(): Promise<McpOAuthState | undefined>
  write(state: McpOAuthState): Promise<void>
  clear(): Promise<void>
}

/** Inputs needed to build one server-scoped MCP OAuth provider. */
export interface McpOAuthProviderOptions {
  serverName: string
  redirectUrl: string
  store: McpOAuthStateStore
  onAuthorizationUrl: (url: URL) => void | Promise<void>
  state?: string | (() => string | Promise<string>)
  clientInformation?: OAuthClientInformationMixed | (() => Promise<OAuthClientInformationMixed | undefined>)
  tokenEndpointAuthMethod?: 'none' | 'client_secret_post' | 'client_secret_basic'
}

function cloneWithout<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _omitted, ...rest } = value
  return rest
}

async function updateState(
  store: McpOAuthStateStore,
  update: (current: McpOAuthState) => McpOAuthState,
): Promise<void> {
  const current = await store.read()
  await store.write(update(current ?? {}))
}

function randomState(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Build the SDK OAuth provider for one MCP server. Token and registration data
 * are read and written only through the supplied host-owned store.
  * @param options - options supplied to this public operation.
  * @returns Result produced by this public operation.
 */
export function createMcpOAuthProvider(options: McpOAuthProviderOptions): OAuthClientProvider {
  const configuredState = options.state
  const metadata: OAuthClientMetadata = {
    client_name: 'PHOENIX MCP client',
    redirect_uris: [options.redirectUrl],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: options.tokenEndpointAuthMethod ?? 'none',
  }

  return {
    redirectUrl: options.redirectUrl,
    clientMetadata: metadata,
    state: configuredState === undefined
      ? randomState
      : typeof configuredState === 'function'
        ? configuredState
        : () => configuredState,
    async clientInformation() {
      if (options.clientInformation !== undefined) {
        return typeof options.clientInformation === 'function'
          ? options.clientInformation()
          : options.clientInformation
      }
      return (await options.store.read())?.clientInformation
    },
    async saveClientInformation(clientInformation) {
      await updateState(options.store, current => ({ ...current, clientInformation }))
    },
    async tokens() {
      return (await options.store.read())?.tokens
    },
    async saveTokens(tokens) {
      await updateState(options.store, current => ({ ...current, tokens }))
    },
    async redirectToAuthorization(authorizationUrl) {
      await options.onAuthorizationUrl(authorizationUrl)
    },
    async saveCodeVerifier(codeVerifier) {
      await updateState(options.store, current => ({ ...current, codeVerifier }))
    },
    async codeVerifier() {
      const verifier = (await options.store.read())?.codeVerifier
      if (verifier === undefined) throw new Error(`MCP OAuth verifier missing for ${options.serverName}`)
      return verifier
    },
    async invalidateCredentials(scope) {
      if (scope === 'all') {
        await options.store.clear()
        return
      }
      await updateState(options.store, (current) => {
        switch (scope) {
          case 'client': return cloneWithout(current, 'clientInformation')
          case 'tokens': return cloneWithout(current, 'tokens')
          case 'verifier': return cloneWithout(current, 'codeVerifier')
          case 'discovery': return cloneWithout(current, 'discoveryState')
        }
      })
    },
    async saveDiscoveryState(discoveryState) {
      await updateState(options.store, current => ({ ...current, discoveryState }))
    },
    async discoveryState() {
      return (await options.store.read())?.discoveryState
    },
  }
}

/**
 * Credential-provider adapter that stores only an opaque MCP OAuth grant.
 * @param credentials - credentials supplied to this public operation.
 * @param key - key supplied to this public operation.
 * @returns Result produced by this public operation.
 */
export function createCredentialStateStore(credentials: CredentialProvider, key: CredentialKey): McpOAuthStateStore {
  let volatileState: McpOAuthState | undefined
  const readPersisted = async (): Promise<McpOAuthState | undefined> => {
    const record = await credentials.readRecord(key)
    if (record?.kind !== 'grant' || record.payload === null || typeof record.payload !== 'object' || Array.isArray(record.payload)) {
      return undefined
    }
    return record.payload
  }
  return {
    async read() {
      const persisted = await readPersisted()
      return volatileState === undefined ? persisted : { ...persisted, ...volatileState }
    },
    async write(state) {
      if (hasUsableMcpOAuthTokens(state)) {
        volatileState = undefined
        await credentials.modifyRecord(key, () => Promise.resolve({ kind: 'grant', payload: state }))
        return
      }
      // Partial OAuth state (discovery metadata, client registration, verifier)
      // must never erase a previously usable grant. The provider helpers merge
      // before writing today, but keeping that invariant inside the store makes
      // restart persistence robust even if an SDK path writes a partial object.
      // Explicit reauthorization/disconnect owns token removal through clear().
      volatileState = state
    },
    async clear() {
      volatileState = undefined
      await credentials.deleteRecord(key)
    },
  }
}

interface McpOAuthCallbackAttempt {
  code: Promise<string>
  close(): void
}

interface PendingCallback {
  expectedState: string
  resolve: (code: string) => void
  reject: (error: Error) => void
  settled: boolean
}

/** One loopback callback server shared by all authorization attempts for a server. */
export class McpOAuthCallbackServer {
  private readonly server: Server
  private readonly path: string
  private readonly port: number
  private pending: PendingCallback | undefined
  private _redirectUri: string | undefined

  constructor(serverName: string, port = 0) {
    this.path = `/mcp/oauth/${encodeURIComponent(serverName)}`
    this.port = port
    this.server = createServer((request, response) => { this.handle(request, response) })
  }

  /** Loopback redirect URI after the callback server has started. */
  get redirectUri(): string {
    if (this._redirectUri === undefined) throw new Error('MCP OAuth callback server has not started')
    return this._redirectUri
  }

  /** Start the loopback OAuth callback server if it is not already listening. */
  async start(): Promise<void> {
    if (this._redirectUri !== undefined) return
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.server.off('listening', onListening)
        reject(error)
      }
      const onListening = (): void => {
        this.server.off('error', onError)
        resolve()
      }
      this.server.once('error', onError)
      this.server.once('listening', onListening)
      this.server.listen(this.port, '127.0.0.1')
    })
    const address = this.server.address()
    if (address === null || typeof address === 'string') {
      await this.close()
      throw new Error('MCP OAuth callback server did not bind an IP port')
    }
    this._redirectUri = `http://127.0.0.1:${address.port}${this.path}`
    this.server.unref()
  }

  /**
   * Begin one state-bound OAuth callback attempt.
   * @param expectedState - CSRF state value that the callback must echo.
   * @param signal - Optional cancellation signal for the authorization attempt.
   * @returns Callback attempt exposing the authorization-code promise and cleanup.
   */
  begin(expectedState: string, signal?: AbortSignal): McpOAuthCallbackAttempt {
    if (this._redirectUri === undefined) throw new Error('MCP OAuth callback server has not started')
    if (this.pending !== undefined) throw new Error('MCP OAuth callback already has an active attempt')
    let resolveCode!: (code: string) => void
    let rejectCode!: (error: Error) => void
    const code = new Promise<string>((resolve, reject) => {
      resolveCode = resolve
      rejectCode = reject
    })
    const pending: PendingCallback = {
      expectedState,
      resolve: resolveCode,
      reject: rejectCode,
      settled: false,
    }
    this.pending = pending
    const abort = (): void => { this.finishError(new Error('MCP OAuth authorization cancelled')) }
    signal?.addEventListener('abort', abort, { once: true })
    return {
      code,
      close: () => {
        signal?.removeEventListener('abort', abort)
        if (this.pending === pending) {
          this.pending = undefined
          pending.settled = true
          pending.reject(new Error('MCP OAuth callback closed'))
        }
      },
    }
  }

  /** Close the callback listener and reject any pending authorization attempt. */
  async close(): Promise<void> {
    this.pending?.reject(new Error('MCP OAuth callback server closed'))
    this.pending = undefined
    if (!this.server.listening) return
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
  }

  private handle(
    request: IncomingMessage,
    response: {
      statusCode: number
      setHeader(name: string, value: string): void
      end(body: string): void
    },
  ): void {
    const finish = (statusCode: number, message: string): void => {
      response.statusCode = statusCode
      response.setHeader('content-type', 'text/plain; charset=utf-8')
      response.setHeader('cache-control', 'no-store')
      response.setHeader('x-content-type-options', 'nosniff')
      response.end(message)
    }
    if (request.method !== 'GET' || request.url === undefined) {
      finish(404, 'Not found')
      return
    }
    const callback = new URL(request.url, 'http://127.0.0.1')
    if (callback.pathname !== this.path) {
      finish(404, 'Not found')
      return
    }
    if (this.pending === undefined) {
      finish(409, 'No authorization is pending. Return to PHOENIX.')
      return
    }
    const pending = this.pending
    if (callback.searchParams.get('state') !== pending.expectedState) {
      this.finishError(new Error('MCP OAuth state did not match'))
      finish(400, 'Authorization rejected. Return to PHOENIX and try again.')
      return
    }
    const providerError = callback.searchParams.get('error')
    if (providerError !== null) {
      this.finishError(new Error(`MCP OAuth authorization failed: ${providerError}`))
      finish(400, 'Authorization was not completed. Return to PHOENIX.')
      return
    }
    const code = callback.searchParams.get('code')
    if (code === null || code.trim() === '') {
      this.finishError(new Error('MCP OAuth callback did not contain an authorization code'))
      finish(400, 'Authorization did not return a code.')
      return
    }
    this.pending = undefined
    pending.settled = true
    pending.resolve(code)
    finish(200, 'Authorization complete. You may return to PHOENIX.')
  }

  private finishError(error: Error): void {
    const pending = this.pending
    if (pending === undefined || pending.settled) return
    this.pending = undefined
    pending.settled = true
    pending.reject(error)
  }
}

/**
 * Whether a stored state contains a token that the SDK can use or refresh.
 * @param state - state supplied to this public operation.
 * @returns Result produced by this public operation.
 */
export function hasUsableMcpOAuthTokens(state: McpOAuthState | undefined): boolean {
  const tokens = state?.tokens
  return typeof tokens?.access_token === 'string' && tokens.access_token.length > 0
    || typeof tokens?.refresh_token === 'string' && tokens.refresh_token.length > 0
}

/**
 * True only for callback errors caused by disposing the Host while OAuth waits.
 * @param error - Callback error or close reason to classify.
 * @returns Whether the error is an expected callback-close condition.
 */
export function isExpectedMcpOAuthClose(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message === 'MCP OAuth callback closed' || message === 'MCP OAuth callback server closed'
}

function mcpCredentialKey(serverName: string): CredentialKey {
  const id = serverName.toLowerCase().replaceAll('_', '-')
  return credentialKey('mcp-client', id)
}

/** Optional fixed-client settings for OAuth servers that do not support DCR. */
export interface McpOAuthControllerOptions {
  callbackPort?: number
  resolveClientInformation?: () => Promise<OAuthClientInformationMixed | undefined>
  tokenEndpointAuthMethod?: 'none' | 'client_secret_post' | 'client_secret_basic'
}

/** Host controller for one MCP server's OAuth lifecycle. */
export class McpOAuthController {
  /** Credential-store key for this MCP server's OAuth state. */
  readonly key: CredentialKey
  /** Loopback callback server used by this controller. */
  readonly callbackServer: McpOAuthCallbackServer
  /** Promise resolved after the callback server is ready to receive redirects. */
  readonly ready: Promise<void>
  private readonly store: McpOAuthStateStore
  private readonly serverName: string
  private readonly serverUrl: string
  private readonly resolveClientInformation: (() => Promise<OAuthClientInformationMixed | undefined>) | undefined
  private readonly tokenEndpointAuthMethod: 'none' | 'client_secret_post' | 'client_secret_basic' | undefined
  private closed = false

  constructor(
    credentials: CredentialProvider,
    serverName: string,
    serverUrl: string,
    options: McpOAuthControllerOptions = {},
  ) {
    this.serverName = serverName
    this.serverUrl = serverUrl
    this.resolveClientInformation = options.resolveClientInformation
    this.tokenEndpointAuthMethod = options.tokenEndpointAuthMethod
    this.key = mcpCredentialKey(serverName)
    this.store = createCredentialStateStore(credentials, this.key)
    this.callbackServer = new McpOAuthCallbackServer(serverName, options.callbackPort)
    this.ready = this.callbackServer.start()
  }

  /**
   * Check whether stored OAuth state has a usable access or refresh token.
   * @returns Whether this MCP server can currently authenticate from stored state.
   */
  async isAuthorized(): Promise<boolean> {
    return hasUsableMcpOAuthTokens(await this.store.read())
  }

  /**
   * Build an SDK OAuth provider bound to this controller's callback URI and store.
   * @param onAuthorizationUrl - Callback invoked when user authorization must open in a browser.
   * @returns OAuth provider consumed by the MCP SDK auth flow.
   */
  provider(onAuthorizationUrl: (url: URL) => void | Promise<void> = () => undefined): OAuthClientProvider {
    return createMcpOAuthProvider({
      serverName: this.serverName,
      redirectUrl: this.callbackServer.redirectUri,
      store: this.store,
      onAuthorizationUrl,
      ...(this.resolveClientInformation === undefined
        ? {}
        : { clientInformation: this.resolveClientInformation }),
      ...(this.tokenEndpointAuthMethod === undefined
        ? {}
        : { tokenEndpointAuthMethod: this.tokenEndpointAuthMethod }),
    })
  }

  /**
   * Run one interactive authorization flow and persist the resulting OAuth state.
   * @param session - Host authorization session used for cancellation and user notification.
   */
  async authorize(session: AuthorizationSession): Promise<void> {
    await this.ready
    const previous = await this.store.read()
    // The callback server deliberately binds an ephemeral loopback port. Any
    // dynamically registered OAuth client from an earlier PHOENIX process is
    // therefore bound to a redirect_uri that no longer exists. Reusing that
    // client_id makes providers such as monday.com reject the new authorization
    // request with "redirect_uri is not registered for this app". An explicit
    // authorization attempt is a fresh registration boundary: keep reusable
    // discovery metadata, but drop the old client registration, tokens, and
    // verifier so the SDK registers a client for the callback URI of this run.
    if (previous !== undefined) {
      const {
        clientInformation: _clientInformation,
        tokens: _tokens,
        codeVerifier: _codeVerifier,
        ...reusable
      } = previous
      // Reauthorization is the one intentional boundary that must hide the
      // previous grant so the SDK performs a fresh redirect/registration.
      // Clear explicitly instead of relying on a partial-state write to delete
      // persisted tokens; failed incidental writes elsewhere must not log users out.
      await this.store.clear()
      await this.store.write(reusable)
    }
    const state = randomState()
    const attempt = this.callbackServer.begin(state, session.signal)
    // The callback promise may be closed during cleanup before the flow reaches
    // `await attempt.code` (for example when discovery fails). Mark its rejection
    // as observed without changing the rejection delivered to the awaiting flow.
    void attempt.code.catch(() => undefined)
    const provider = createMcpOAuthProvider({
      serverName: this.serverName,
      redirectUrl: this.callbackServer.redirectUri,
      store: this.store,
      state,
      onAuthorizationUrl: (url) => {
        session.notify({
          message: `Continúa en tu navegador para autorizar ${this.serverName}. PHOENIX conserva los tokens solo en el Host.`,
          url: String(url),
        })
      },
      ...(this.resolveClientInformation === undefined
        ? {}
        : { clientInformation: this.resolveClientInformation }),
      ...(this.tokenEndpointAuthMethod === undefined
        ? {}
        : { tokenEndpointAuthMethod: this.tokenEndpointAuthMethod }),
    })
    try {
      const first = await auth(provider, { serverUrl: this.serverUrl })
      if (first !== 'REDIRECT') return
      const code = await attempt.code
      const final = await auth(provider, { serverUrl: this.serverUrl, authorizationCode: code })
      if (final !== 'AUTHORIZED') throw new Error(`MCP OAuth did not authorize ${this.serverName}`)
    } catch (error) {
      if (!this.closed || !isExpectedMcpOAuthClose(error)) throw error
    } finally {
      attempt.close()
    }
  }

  /** Clear persisted OAuth state for this MCP server. */
  async disconnect(): Promise<void> {
    await this.store.clear()
  }

  /** Close this controller and its loopback callback server. */
  async close(): Promise<void> {
    this.closed = true
    await this.callbackServer.close()
  }
}
