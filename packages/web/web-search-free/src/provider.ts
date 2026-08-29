/** Free, keyless HTML search provider for Bing and DuckDuckGo. */
import { WebError, type WebSearchProvider, type WebSearchRequest, type WebSearchResult, type WebSearchSource } from '@phoenix-ai/dsh-web'

/** Public HTML search engine supported by the keyless provider. */
export type FreeSearchEngine = 'bing' | 'duckduckgo'
/** Injectable fetch boundary used by tests and host integrations. */
export type FreeSearchFetcher = (input: string, init?: RequestInit) => Promise<Response>

/** Configuration for the free search provider. */
export interface FreeSearchProviderOptions {
  readonly engines?: readonly FreeSearchEngine[]
  readonly timeoutMs?: number
  readonly fetcher?: FreeSearchFetcher
}

const DEFAULT_ENGINES: readonly FreeSearchEngine[] = ['bing', 'duckduckgo']
const DEFAULT_TIMEOUT_MS = 8_000

/** Stable provider id used by `ctx.web`. */
export const FREE_SEARCH_PROVIDER_ID = 'free-html'

/** Searches public Bing and DuckDuckGo HTML endpoints without credentials. */
export class FreeSearchProvider implements WebSearchProvider {
  readonly id = FREE_SEARCH_PROVIDER_ID
  private readonly engines: readonly FreeSearchEngine[]
  private readonly timeoutMs: number
  private readonly fetcher: FreeSearchFetcher

  constructor(options: FreeSearchProviderOptions = {}) {
    this.engines = options.engines ?? DEFAULT_ENGINES
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
  }

  available(): boolean {
    return this.engines.length > 0 && this.timeoutMs > 0
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    if (!this.available()) throw new WebError('no free search engine is configured', 'WEB_PROVIDER_UNAVAILABLE')
    if (signal?.aborted === true) throw signal.reason ?? new WebError('web search was aborted', 'WEB_SEARCH_ABORTED')

    for (const engine of this.engines) {
      const response = await this.fetchEngine(engine, request.query, signal)
      if (!response.ok) continue
      const sources = engine === 'bing' ? parseBing(await response.text()) : parseDuckDuckGo(await response.text())
      if (sources.length > 0) {
        return {
          sources: capSources(sources, request.maxResults),
          truncated: request.maxResults !== undefined && sources.length > request.maxResults,
        }
      }
    }
    throw new WebError('no free search engine returned results', 'WEB_PROVIDER_TRANSIENT')
  }

  private async fetchEngine(engine: FreeSearchEngine, query: string, signal?: AbortSignal): Promise<Response> {
    const endpoint = engine === 'bing' ? 'https://www.bing.com/search' : 'https://html.duckduckgo.com/html/'
    const url = `${endpoint}?q=${encodeURIComponent(query).replace(/%20/g, '+')}`
    const controller = new AbortController()
    const timer = setTimeout(() =>{  controller.abort(new Error('free search timeout')) }, this.timeoutMs)
    const combined = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
    try {
      return await this.fetcher(url, { signal: combined, headers: { accept: 'text/html' } })
    } catch (error) {
      if (signal?.aborted === true) throw signal.reason ?? error
      return new Response('', { status: 599 })
    } finally {
      clearTimeout(timer)
    }
  }
}

function parseBing(html: string): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  const itemPattern = new RegExp(
    '<li[^>]*class=["\\\'][^"\\\']*b_algo[^"\\\']*["\\\'][\\s\\S]*?'
      + '<h2[^>]*>\\s*<a[^>]*href=["\\\']([^"\\\']+)["\\\'][^>]*>([\\s\\S]*?)<\\/a>'
      + '[\\s\\S]*?<p[^>]*>([\\s\\S]*?)<\\/p>',
    'gi',
  )
  for (const match of html.matchAll(itemPattern)) {
    sources.push({
      url: normalizeBingUrl(decodeHtml(match[1] ?? '')),
      title: stripHtml(match[2] ?? ''),
      snippet: stripHtml(match[3] ?? ''),
    })
  }
  return sources.filter(source => isHttpUrl(source.url))
}

function parseDuckDuckGo(html: string): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  const itemPattern = new RegExp(
    '<a[^>]*class=["\\\'][^"\\\']*result__a[^"\\\']*["\\\'][^>]*'
      + 'href=["\\\']([^"\\\']+)["\\\'][^>]*>([\\s\\S]*?)<\\/a>'
      + '[\\s\\S]*?(?:<a[^>]*class=["\\\'][^"\\\']*result__snippet[^"\\\']*["\\\']'
      + '[^>]*>([\\s\\S]*?)<\\/a>)?',
    'gi',
  )
  for (const match of html.matchAll(itemPattern)) {
    sources.push({
      url: decodeHtml(match[1] ?? ''),
      title: stripHtml(match[2] ?? ''),
      ...(match[3] === undefined ? {} : { snippet: stripHtml(match[3]) }),
    })
  }
  return sources.filter(source => isHttpUrl(source.url))
}

function normalizeBingUrl(url: string): string {
  try {
    const encoded = new URL(url).searchParams.get('u')
    if (encoded?.startsWith('a1')) {
      const base64 = encoded.slice(2).replace(/-/g, '+').replace(/_/g, '/')
      return Buffer.from(base64, 'base64').toString('utf8')
    }
  } catch {
    // Keep the original URL when Bing changes its redirect shape.
  }
  return url
}

function capSources(sources: WebSearchSource[], maxResults: number | undefined): WebSearchSource[] {
  return maxResults === undefined ? sources : sources.slice(0, maxResults)
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

function decodeHtml(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}
