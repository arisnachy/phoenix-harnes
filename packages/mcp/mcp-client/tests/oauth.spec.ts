import { describe, expect, it, vi } from 'vitest'
import { auth } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthTokens, OAuthClientInformationMixed } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  auth: vi.fn(),
}))

import {
  McpOAuthCallbackServer,
  McpOAuthController,
  createCredentialStateStore,
  createMcpOAuthProvider,
  hasUsableMcpOAuthTokens,
  isExpectedMcpOAuthClose,
  type McpOAuthStateStore,
} from '@phoenix-ai/dsh-mcp-client/src/oauth.ts'
import { credentialKey, type CredentialProvider } from '@phoenix-ai/dsh-credentials'

function store(initial?: Record<string, unknown>): McpOAuthStateStore & { state: Record<string, unknown> | undefined } {
  let state = initial
  return {
    get state() { return state },
    async read() { return state },
    async write(next) { state = next as Record<string, unknown> },
    async clear() { state = undefined },
  }
}

describe('createMcpOAuthProvider', () => {
  it('persists OAuth tokens through the host-only state store', async () => {
    const backing = store()
    const provider = createMcpOAuthProvider({
      serverName: 'notion-notion',
      redirectUrl: 'http://127.0.0.1:43210/mcp/oauth/notion-notion',
      store: backing,
      onAuthorizationUrl: vi.fn(),
    })
    const tokens: OAuthTokens = {
      access_token: 'access-secret',
      token_type: 'Bearer',
      refresh_token: 'refresh-secret',
      expires_in: 3600,
    }

    await provider.saveTokens(tokens)

    expect(await provider.tokens()).toEqual(tokens)
    expect(backing.state).toMatchObject({ tokens })
  })

  it('preserves the previous refresh token when a renewal response omits it', async () => {
    const backing = store({
      tokens: {
        access_token: 'old-access',
        token_type: 'Bearer',
        refresh_token: 'durable-refresh',
        expires_in: 3600,
      },
    })
    const provider = createMcpOAuthProvider({
      serverName: 'notion-notion',
      redirectUrl: 'http://127.0.0.1:43210/mcp/oauth/notion-notion',
      store: backing,
      onAuthorizationUrl: vi.fn(),
    })

    await provider.saveTokens({
      access_token: 'new-access',
      token_type: 'Bearer',
      expires_in: 3600,
    })

    expect(await provider.tokens()).toEqual({
      access_token: 'new-access',
      token_type: 'Bearer',
      refresh_token: 'durable-refresh',
      expires_in: 3600,
    })
  })

  it('publishes public client metadata without client secrets', () => {
    const provider: OAuthClientProvider = createMcpOAuthProvider({
      serverName: 'notion-notion',
      redirectUrl: 'http://127.0.0.1:43210/mcp/oauth/notion-notion',
      store: store(),
      onAuthorizationUrl: vi.fn(),
    })

    expect(provider.clientMetadata).toMatchObject({
      client_name: 'PHOENIX MCP client',
      redirect_uris: ['http://127.0.0.1:43210/mcp/oauth/notion-notion'],
      token_endpoint_auth_method: 'none',
    })
    expect(provider.clientMetadata).not.toHaveProperty('client_secret')
  })

  it('uses a configured confidential client instead of stale dynamic registration', async () => {
    const backing = store({ clientInformation: { client_id: 'stale-dcr-client' } })
    const provider = createMcpOAuthProvider({
      serverName: 'slack',
      redirectUrl: 'http://127.0.0.1:17844/mcp/oauth/slack',
      store: backing,
      onAuthorizationUrl: vi.fn(),
      clientInformation: async () => ({
        client_id: 'phoenix-slack-client',
        client_secret: 'phoenix-slack-secret',
      }),
      tokenEndpointAuthMethod: 'client_secret_post',
    })

    expect(provider.clientMetadata).toMatchObject({
      redirect_uris: ['http://127.0.0.1:17844/mcp/oauth/slack'],
      token_endpoint_auth_method: 'client_secret_post',
    })
    await expect(provider.clientInformation()).resolves.toEqual({
      client_id: 'phoenix-slack-client',
      client_secret: 'phoenix-slack-secret',
    })
  })

  it('clears only requested credentials and preserves discovery state', async () => {
    const clientInformation: OAuthClientInformationMixed = { client_id: 'client-id' }
    const discoveryState: OAuthDiscoveryState = { authorizationServerUrl: 'https://mcp.notion.com' }
    const backing = store({ clientInformation, discoveryState, tokens: { access_token: 'secret' } })
    const provider = createMcpOAuthProvider({
      serverName: 'notion-notion',
      redirectUrl: 'http://127.0.0.1:43210/mcp/oauth/notion-notion',
      store: backing,
      onAuthorizationUrl: vi.fn(),
    })

    await provider.invalidateCredentials?.('tokens')

    expect(await provider.tokens()).toBeUndefined()
    expect(await provider.clientInformation()).toEqual(clientInformation)
    expect(await provider.discoveryState?.()).toEqual(discoveryState)
  })

  it('delivers a matching callback code and rejects a mismatched state', async () => {
    const callback = new McpOAuthCallbackServer('notion-notion')
    await callback.start()
    const pending = callback.begin('expected-state')
    const rejectedCode = expect(pending.code).rejects.toThrow(/state/i)

    const rejected = await fetch(`${callback.redirectUri}?code=bad&state=wrong-state`)
    expect(rejected.status).toBe(400)
    await rejectedCode

    const second = callback.begin('expected-state')
    const accepted = fetch(`${callback.redirectUri}?code=good-code&state=expected-state`)
    await expect(second.code).resolves.toBe('good-code')
    expect((await accepted).status).toBe(200)
    await callback.close()
  })

  it('keeps pre-token state volatile and persists only a usable grant', async () => {
    const records = new Map<string, unknown>()
    const credentials = {
      readRecord: async (key: unknown) => records.get(String(key)),
      modifyRecord: async (key: unknown, mutate: (current: unknown) => Promise<unknown>) => {
        const next = await mutate(records.get(String(key)))
        if (next !== undefined) records.set(String(key), next)
        return next
      },
      deleteRecord: async (key: unknown) => { records.delete(String(key)) },
    } as unknown as CredentialProvider
    const state = createCredentialStateStore(credentials, credentialKey('mcp-client', 'notion-notion'))
    const clientInformation = { client_id: 'client-id' }
    await state.write({ clientInformation })
    expect(records.size).toBe(0)
    expect(await state.read()).toEqual({ clientInformation })

    const tokens = { access_token: 'access-token', token_type: 'Bearer' }
    await state.write({ clientInformation, tokens })
    expect(records.size).toBe(1)
    expect(await state.read()).toEqual({ clientInformation, tokens })

    await state.write({ clientInformation })
    expect(records.size).toBe(0)
  })

  it('reuses a dynamic client registered by this Host so authorization can publish its URL', async () => {
    const records = new Map<string, unknown>()
    const credentials = {
      readRecord: vi.fn(async (recordKey: unknown) => records.get(String(recordKey))),
      modifyRecord: vi.fn(async (recordKey: unknown, mutate: (current: unknown) => Promise<unknown>) => {
        const next = await mutate(records.get(String(recordKey)))
        if (next === undefined) records.delete(String(recordKey))
        else records.set(String(recordKey), next)
        return next
      }),
      deleteRecord: vi.fn(async (recordKey: unknown) => { records.delete(String(recordKey)) }),
    } as unknown as CredentialProvider
    const controller = new McpOAuthController(
      credentials,
      'notion',
      'https://mcp.notion.com/mcp',
    )
    const authorizationUrl = new URL('https://mcp.notion.com/authorize?client_id=current-runtime-client')
    const notify = vi.fn()

    try {
      await controller.ready

      // StreamableHTTPClientTransport performs discovery/DCR while probing the
      // unauthenticated server. That registration belongs to this controller's
      // current loopback callback and must survive the later user click.
      const transportProvider = controller.provider()
      await transportProvider.saveClientInformation?.({ client_id: 'current-runtime-client' })
      await transportProvider.saveDiscoveryState?.({
        authorizationServerUrl: 'https://mcp.notion.com',
      })

      vi.mocked(auth).mockImplementationOnce(async (provider) => {
        expect(await provider.clientInformation()).toEqual({ client_id: 'current-runtime-client' })
        expect(provider.clientMetadata.redirect_uris).toEqual([controller.callbackServer.redirectUri])
        await provider.redirectToAuthorization(authorizationUrl)
        return 'AUTHORIZED'
      })

      await expect(controller.authorize({
        method: 'oauth',
        signal: new AbortController().signal,
        notify,
        prompt: vi.fn(),
      })).resolves.toBeUndefined()

      expect(notify).toHaveBeenCalledWith({
        message: 'Continúa en tu navegador para autorizar notion. PHOENIX conserva los tokens solo en el Host.',
        url: authorizationUrl.href,
      })
    } finally {
      await controller.close()
    }
  })

  it('drops a stale dynamic client registration before reauthorization on a new loopback redirect', async () => {
    const key = credentialKey('mcp-client', 'monday-com-monday-com')
    const records = new Map<string, unknown>([[
      String(key),
      {
        kind: 'grant',
        payload: {
          clientInformation: { client_id: 'client-registered-for-old-port' },
          tokens: { access_token: 'expired-access', token_type: 'Bearer' },
          codeVerifier: 'old-verifier',
          discoveryState: { authorizationServerUrl: 'https://auth.monday.com' },
        },
      },
    ]])
    const credentials = {
      readRecord: vi.fn(async (recordKey: unknown) => records.get(String(recordKey))),
      modifyRecord: vi.fn(async (recordKey: unknown, mutate: (current: unknown) => Promise<unknown>) => {
        const next = await mutate(records.get(String(recordKey)))
        if (next === undefined) records.delete(String(recordKey))
        else records.set(String(recordKey), next)
        return next
      }),
      deleteRecord: vi.fn(async (recordKey: unknown) => { records.delete(String(recordKey)) }),
    } as unknown as CredentialProvider

    vi.mocked(auth).mockImplementationOnce(async (provider) => {
      expect(await provider.clientInformation()).toBeUndefined()
      expect(await provider.tokens()).toBeUndefined()
      await expect(provider.codeVerifier()).rejects.toThrow(/verifier missing/i)
      expect(await provider.discoveryState?.()).toEqual({ authorizationServerUrl: 'https://auth.monday.com' })
      return 'AUTHORIZED'
    })

    const controller = new McpOAuthController(
      credentials,
      'monday-com-monday-com',
      'https://mcp.monday.com',
    )
    try {
      await controller.ready
      await expect(controller.authorize({
        method: 'oauth',
        signal: new AbortController().signal,
        notify: vi.fn(),
        prompt: vi.fn(),
      })).resolves.toBeUndefined()
    } finally {
      await controller.close()
    }
  })

  it('reports connected only when access or refresh tokens exist', () => {
    expect(hasUsableMcpOAuthTokens(undefined)).toBe(false)
    expect(hasUsableMcpOAuthTokens({ clientInformation: { client_id: 'id' } })).toBe(false)
    expect(hasUsableMcpOAuthTokens({ tokens: { access_token: 'access', token_type: 'Bearer' } })).toBe(true)
    expect(hasUsableMcpOAuthTokens({ tokens: { access_token: '', refresh_token: 'refresh', token_type: 'Bearer' } })).toBe(true)
  })

  it('classifies callback closure during Host shutdown as an expected cancellation', () => {
    expect(isExpectedMcpOAuthClose(new Error('MCP OAuth callback closed'))).toBe(true)
    expect(isExpectedMcpOAuthClose(new Error('MCP OAuth callback server closed'))).toBe(true)
    expect(isExpectedMcpOAuthClose(new Error('MCP OAuth state did not match'))).toBe(false)
  })

  it('bounds discovery requests and propagates authorization cancellation to the HTTP request', async () => {
    const credentials = {
      readRecord: vi.fn(async () => undefined),
      modifyRecord: vi.fn(),
      deleteRecord: vi.fn(),
    } as unknown as CredentialProvider
    const controller = new McpOAuthController(credentials, 'notion', 'https://mcp.notion.com')
    await controller.ready
    const cancellation = new AbortController()
    const deadline = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      expect(options?.signal?.aborted).toBe(false)
      cancellation.abort(new Error('authorization cancelled'))
      expect(options?.signal?.aborted).toBe(true)
      throw options?.signal?.reason
    })
    vi.mocked(auth).mockImplementationOnce(async (_provider, options) => {
      if (options.fetchFn === undefined) throw new Error('unbounded discovery')
      await options.fetchFn('https://mcp.notion.com/.well-known/oauth-authorization-server')
      return 'AUTHORIZED'
    })
    try {
      await expect(controller.authorize({
        method: 'oauth', signal: cancellation.signal, notify: vi.fn(), prompt: vi.fn(),
      })).rejects.toThrow('authorization cancelled')
      expect(timeout).toHaveBeenCalledWith(30_000)
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally {
      fetch.mockRestore()
      timeout.mockRestore()
      await controller.close()
    }
  })

  it('does not leak a callback rejection when OAuth fails before redirect', async () => {
    vi.mocked(auth).mockRejectedValueOnce(new Error('discovery failed'))
    const credentials = {
      readRecord: vi.fn(async () => undefined),
      modifyRecord: vi.fn(async (_key: unknown, mutate: (current: unknown) => Promise<unknown>) => mutate(undefined)),
      deleteRecord: vi.fn(async () => undefined),
    } as unknown as CredentialProvider
    const controller = new McpOAuthController(credentials, 'figma-figma', 'https://mcp.figma.com')
    await controller.ready
    const unhandled = vi.fn()
    process.once('unhandledRejection', unhandled)
    try {
      await expect(controller.authorize({
        method: 'oauth',
        signal: new AbortController().signal,
        notify: vi.fn(),
        prompt: vi.fn(),
      })).rejects.toThrow('discovery failed')
      await new Promise(resolve => setImmediate(resolve))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.removeListener('unhandledRejection', unhandled)
      await controller.close()
    }
  })
})
