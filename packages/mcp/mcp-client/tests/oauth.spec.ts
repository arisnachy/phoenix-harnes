import { describe, expect, it, vi } from 'vitest'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthTokens, OAuthClientInformationMixed } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import {
  McpOAuthCallbackServer,
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
    await expect((await second).code).resolves.toBe('good-code')
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
})
