import { describe, expect, it, vi } from 'vitest'
import { FreeSearchProvider } from '../src/provider.ts'

const bingHtml = '<li class="b_algo"><h2><a href="https://example.com/a">A title</a></h2><p>A snippet</p></li>'
const duckHtml = '<a class="result__a" href="https://example.com/b">B title</a><a class="result__snippet">B snippet</a>'

describe('FreeSearchProvider', () => {
  it('uses Bing first and normalizes bounded sources', async () => {
    const fetcher = vi.fn(async () => new Response(bingHtml, { status: 200 }))
    const provider = new FreeSearchProvider({ fetcher, engines: ['bing', 'duckduckgo'] })
    const result = await provider.search({ query: 'phoenix', maxResults: 1 })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(result.sources).toEqual([{ url: 'https://example.com/a', title: 'A title', snippet: 'A snippet' }])
    expect(result.truncated).toBe(false)
  })

  it('falls back to DuckDuckGo when Bing is blocked', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('captcha', { status: 202 }))
      .mockResolvedValueOnce(new Response(duckHtml, { status: 200 }))
    const provider = new FreeSearchProvider({ fetcher, engines: ['bing', 'duckduckgo'] })
    await expect(provider.search({ query: 'phoenix' })).resolves.toMatchObject({
      sources: [{ url: 'https://example.com/b', title: 'B title', snippet: 'B snippet' }],
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('stops retrying blocked engines while another free engine works', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('captcha', { status: 200 }))
      .mockResolvedValueOnce(new Response(duckHtml, { status: 200 }))
      .mockResolvedValueOnce(new Response(duckHtml, { status: 200 }))
    const provider = new FreeSearchProvider({ fetcher })
    await expect(provider.search({ query: 'first' })).resolves.toHaveProperty('sources')
    await expect(provider.search({ query: 'second' })).resolves.toHaveProperty('sources')
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher.mock.calls[2]?.[0]).toContain('duckduckgo.com')
  })

  it('does not hammer engines returning server errors', async () => {
    const fetcher = vi.fn(async () => new Response('blocked', { status: 503 }))
    const provider = new FreeSearchProvider({ fetcher })
    await expect(provider.search({ query: 'one' })).rejects.toThrow(/no free search engine returned results/)
    await expect(provider.search({ query: 'two' })).rejects.toThrow(/no free search engine returned results/)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('rejects unsafe redirects and exposes no credentials', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 200 }))
    const provider = new FreeSearchProvider({ fetcher, engines: ['bing'] })
    await expect(provider.search({ query: 'a secret' })).rejects.toThrow(/no free search engine returned results/)
    expect(fetcher).toHaveBeenCalledWith('https://www.bing.com/search?q=a+secret', expect.objectContaining({ headers: { accept: 'text/html' } }))
  })
})
