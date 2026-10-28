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
    expect(fetcher).toHaveBeenCalledWith('https://www.bing.com/search?q=a+secret', expect.objectContaining({ headers: { accept: 'text/html' } }))
  })
  it('parses Bing entries without snippets and with extra anchor attributes', async () => {
    const html = '<li class="b_algo"><h2><a data-id="one" href="https://university.edu/thesis">Thesis &amp; guidelines</a></h2></li>'
    const fetcher = vi.fn(async () => new Response(html, { status: 200 }))
    const result = await new FreeSearchProvider({ fetcher, engines: ['bing'] }).search({ query: 'thesis' })
    expect(result.sources).toEqual([{ url: 'https://university.edu/thesis', title: 'Thesis & guidelines' }])
  })

  it('unwraps DuckDuckGo redirect links and tolerates href before class', async () => {
    const html = '<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Funiversity.edu%2Fgraduate" class="result__a">Graduate guidelines</a><a class="result__snippet">University thesis instructions</a>'
    const fetcher = vi.fn(async () => new Response(html, { status: 200 }))
    const result = await new FreeSearchProvider({ fetcher, engines: ['duckduckgo'] }).search({ query: 'thesis' })
    expect(result.sources).toEqual([{
      url: 'https://university.edu/graduate', title: 'Graduate guidelines', snippet: 'University thesis instructions',
    }])
  })

  it('returns the backup when the primary stalls, then cancels the losing request', async () => {
    let primaryAborted = false
    const fetcher = vi.fn((url: string, init?: RequestInit): Promise<Response> => {
      if (url.includes('bing.com')) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            primaryAborted = true
            reject(new Error('cancelled by winner'))
          }, { once: true })
        })
      }
      return Promise.resolve(new Response(duckHtml, { status: 200 }))
    })
    const provider = new FreeSearchProvider({ fetcher, timeoutMs: 2_000 })
    const result = await provider.search({ query: 'thesis' })
    expect(result.sources[0]?.url).toBe('https://example.com/b')
    expect(primaryAborted).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not launch the delayed backup after a quick successful primary', async () => {
    const fetcher = vi.fn(async () => new Response(bingHtml, { status: 200 }))
    const provider = new FreeSearchProvider({ fetcher })
    await expect(provider.search({ query: 'thesis' })).resolves.toMatchObject({
      sources: [{ url: 'https://example.com/a' }],
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('preserves caller cancellation rather than disguising it as an empty result', async () => {
    const controller = new AbortController()
    controller.abort(new Error('user cancelled research'))
    const fetcher = vi.fn()
    const provider = new FreeSearchProvider({ fetcher })
    await expect(provider.search({ query: 'test', maxResults: 2 }, controller.signal))
      .rejects.toThrow('user cancelled research')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not attach a later result snippet to a preceding empty result', async () => {
    const html = '<a class="result__a" href="https://one.edu">First</a>'
      + '<a class="result__a" href="https://two.edu">Second</a>'
      + '<a class="result__snippet">Second only</a>'
    const fetcher = vi.fn(async () => new Response(html, { status: 200 }))
    const result = await new FreeSearchProvider({ fetcher, engines: ['duckduckgo'] }).search({ query: 'university' })
    expect(result.sources).toEqual([
      { url: 'https://one.edu/', title: 'First' },
      { url: 'https://two.edu/', title: 'Second', snippet: 'Second only' },
    ])
  })

})
