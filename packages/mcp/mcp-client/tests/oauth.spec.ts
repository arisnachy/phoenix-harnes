import { describe, expect, it, vi } from 'vitest'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthTokens, OAuthClientInformationMixed } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import {
  McpOAuthCallbackServer,
  createMcpOAuthProvider,
  hasUsableMcpOAuthTokens,
  type McpOAuthStateStore,
} from '@phoenix-ai/dsh-mcp-client/src/oauth.ts'

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

  it('reports connected only when access or refresh tokens exist', () => {
    expect(hasUsableMcpOAuthTokens(undefined)).toBe(false)
    expect(hasUsableMcpOAuthTokens({ clientInformation: { client_id: 'id' } })).toBe(false)
    expect(hasUsableMcpOAuthTokens({ tokens: { access_token: 'access', token_type: 'Bearer' } })).toBe(true)
    expect(hasUsableMcpOAuthTokens({ tokens: { access_token: '', refresh_token: 'refresh', token_type: 'Bearer' } })).toBe(true)
  })
})
