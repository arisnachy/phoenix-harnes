import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  mapOpenRouterResponse,
  OpenRouterSearchProvider,
  OPENROUTER_SEARCH_PROVIDER_ID,
} from '@deepseek-ai/dsh-web-search-openrouter'

afterEach(() => { vi.unstubAllGlobals() })

describe('OpenRouterSearchProvider', () => {
  it('uses the current server-tool contract and maps standardized citations', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('expected a JSON request body')
      const body = JSON.parse(init.body) as {
        tools: unknown[]
        model: string
      }
      expect(body.model).toBe('openrouter/auto')
      expect(body.tools).toEqual([{
        type: 'openrouter:web_search',
        parameters: { engine: 'auto', max_results: 3, max_total_results: 3 },
      }])
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret')
      return new Response(JSON.stringify({
        choices: [{ message: {
          content: 'Grounded answer',
          annotations: [
            { type: 'url_citation', url_citation: { url: 'https://a.test/story', title: 'A', content: 'Excerpt' } },
            { type: 'url_citation', url_citation: { url: 'https://a.test/story', title: 'duplicate' } },
            { type: 'url_citation', url_citation: { url: 'not-a-url' } },
          ],
        } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const provider = new OpenRouterSearchProvider(() => ({
      apiKey: 'secret',
      baseURL: 'https://openrouter.ai/api/v1',
      model: 'openrouter/auto',
    }))

    expect(provider.id).toBe(OPENROUTER_SEARCH_PROVIDER_ID)
    await expect(provider.search({ query: 'phoenix', maxResults: 3 })).resolves.toEqual({
      content: 'Grounded answer',
      sources: [{ url: 'https://a.test/story', title: 'A', snippet: 'Excerpt' }],
      truncated: false,
    })
  })

  it('resolves the managed OpenRouter credential per request without returning it', async () => {
    const authorizationHeaders: string[] = []
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      authorizationHeaders.push(new Headers(init?.headers).get('authorization') ?? '')
      return new Response(JSON.stringify({ choices: [{ message: { annotations: [] } }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    let key = 'first'
    const provider = new OpenRouterSearchProvider(() => ({
      resolveApiKey: async () => key,
      apiKeyEnv: 'OPENROUTER_API_KEY',
      baseURL: 'https://openrouter.ai/api/v1/',
      model: 'openrouter/auto',
    }))
    await provider.search({ query: 'one' })
    key = 'second'
    await provider.search({ query: 'two' })
    expect(authorizationHeaders).toEqual(['Bearer first', 'Bearer second'])
  })

  it('fails with an actionable missing-credential error', async () => {
    const provider = new OpenRouterSearchProvider(() => ({
      resolveApiKey: async () => undefined,
      apiKeyEnv: 'OPENROUTER_API_KEY',
      baseURL: 'https://openrouter.ai/api/v1',
      model: 'openrouter/auto',
    }))
    await expect(provider.search({ query: 'q' })).rejects.toSatisfy((error: unknown) => {
      return error instanceof Error
        && 'code' in error
        && error.code === 'WEB_PROVIDER_CREDENTIAL_MISSING'
        && error.message.includes('Settings > Models')
    })
  })
})

describe('mapOpenRouterResponse', () => {
  it('accepts an empty result without inventing citations', () => {
    expect(mapOpenRouterResponse({ choices: [{ message: { content: '' } }] })).toEqual({ sources: [], truncated: false })
  })
})
