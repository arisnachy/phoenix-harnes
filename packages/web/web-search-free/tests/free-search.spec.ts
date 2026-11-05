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

  it('rejects unsafe redirects and exposes no credentials', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 200 }))
    const provider = new FreeSearchProvider({ fetcher, engines: ['bing'] })
    await expect(provider.search({ query: 'a secret' })).rejects.toThrow(/no free search engine returned results/)
    expect(fetcher).toHaveBeenCalledWith('https://www.bing.com/search?q=a+secret', expect.objectContaining({ headers: { accept: 'text/html', 'user-agent': 'PHOENIX-ResearchBot/1.0 (+https://github.com/arisnachy/phoenix-harnes)' } }))
  })
})


describe('free official API and challenge cooldown', () => {
  it('uses free Wikipedia JSON API after both HTML engines are challenged', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('captcha', { status: 202 }))
      .mockResolvedValueOnce(new Response('blocked', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ query: { search: [
        { title: 'Salud pública', snippet: 'Estudio de <b>salud</b>' },
      ] } }), { status: 200 }))
    const provider = new FreeSearchProvider({ fetcher })
    const result = await provider.search({ query: 'salud' })
    expect(result.sources[0]?.url).toContain('es.wikipedia.org/wiki/')
    expect(result.sources[0]?.snippet).toBe('Estudio de salud')
    expect(fetcher).toHaveBeenCalledTimes(3)
    await provider.search({ query: 'salud' })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})

describe('free-search defensive recovery from real anti-bot responses', () => {
  it('drops HTTP 200 challenge pages and falls back to an alternative source', async () => {
    const html = '<html><title>Just a moment...</title><div class="cf-chl-widget">Checking browser</div></html>'
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response(duckHtml, { status: 200 }))
    const provider = new FreeSearchProvider({ fetcher, engines: ['bing', 'duckduckgo'] })
    const result = await provider.search({ query: 'phoenix' })
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]?.url).toBe('https://example.com/b')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('rejects false positive movie It results when searching Artemis II', async () => {
    const movie = '<li class="b_algo"><h2><a href="https://example.com/it-film">It 2017 film</a></h2><p>Trailer</p></li>'
    const nasa = '<a class="result__a" href="https://www.nasa.gov/artemis-ii/">Artemis II NASA launch</a>'
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(movie, { status: 200 }))
      .mockResolvedValueOnce(new Response(nasa, { status: 200 }))
    const provider = new FreeSearchProvider({ fetcher, engines: ['bing', 'duckduckgo'] })
    const result = await provider.search({ query: 'Artemis II NASA 2026 official launch date' })
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]?.url).toBe('https://www.nasa.gov/artemis-ii/')
  })

  it('decodes numeric HTML entities in snippets and titles without fabricating data', async () => {
    const html = '<li class="b_algo"><h2><a href="https://example.com/dengue">Epidemiolog&#237;a</a></h2><p>Informaci&#243;n sobre dengue</p></li>'
    const fetcher = vi.fn(async () => new Response(html, { status: 200 }))
    const provider = new FreeSearchProvider({ fetcher, engines: ['bing'] })
    const result = await provider.search({ query: 'dengue epidemiologia 2026' })
    expect(result.sources[0]?.title).toBe('Epidemiología')
    expect(result.sources[0]?.snippet).toBe('Información sobre dengue')
  })
})
