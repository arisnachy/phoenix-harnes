/** Free-first source discovery. Engines may block automated search; never evade challenges. */
import { WebError, type WebSearchProvider, type WebSearchRequest, type WebSearchResult, type WebSearchSource } from '@phoenix-ai/dsh-web'

/** Public HTML search engine supported by the keyless provider. */
export type FreeSearchEngine = 'bing' | 'duckduckgo' | 'wikipedia'
/** Injectable fetch boundary used by tests and host integrations. */
export type FreeSearchFetcher = (input: string, init?: RequestInit) => Promise<Response>

/** Configuration for the free search provider. */
export interface FreeSearchProviderOptions {
  readonly engines?: readonly FreeSearchEngine[]
  readonly timeoutMs?: number
  readonly fetcher?: FreeSearchFetcher
}

const DEFAULT_ENGINES: readonly FreeSearchEngine[] = ['bing', 'duckduckgo', 'wikipedia']
const PHOENIX_USER_AGENT = 'PHOENIX-ResearchBot/1.0 (+https://github.com/arisnachy/phoenix-harnes)'
const DEFAULT_TIMEOUT_MS = 8_000

/** Stable provider id used by `ctx.web`. */
export const FREE_SEARCH_PROVIDER_ID = 'free-html'

/** Searches public Bing and DuckDuckGo HTML endpoints without credentials. */
export class FreeSearchProvider implements WebSearchProvider {
  readonly id = FREE_SEARCH_PROVIDER_ID
  private readonly engines: readonly FreeSearchEngine[]
  private readonly timeoutMs: number
  private readonly fetcher: FreeSearchFetcher
  private readonly engineCooldown = new Map<FreeSearchEngine, number>()
  private readonly queryCache = new Map<string, { expires: number; result: WebSearchResult }>()

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
    const cacheKey = JSON.stringify([request.query, request.maxResults])
    const cached = this.queryCache.get(cacheKey)
    if (cached !== undefined && cached.expires > Date.now()) return cached.result

    for (const engine of this.engines) {
      if ((this.engineCooldown.get(engine) ?? 0) > Date.now()) continue
      const response = await this.fetchEngine(engine, request.query, signal)
      if ([202, 403, 429, 503].includes(response.status)) {
        this.engineCooldown.set(engine, Date.now() + 120_000)
        await response.body?.cancel().catch(() => {})
        continue
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        continue
      }
      let sources: WebSearchSource[]
      try {
        if (engine === 'wikipedia') sources = parseWikipedia(await response.json())
        else {
          const html = await response.text()
          // Many challenges return HTTP 200 with a CAPTCHA page. Never treat
          // those pages as search results or immediately retry the same host.
          if (isChallengePage(html)) {
            this.engineCooldown.set(engine, Date.now() + 120_000)
            continue
          }
          sources = engine === 'bing' ? parseBing(html) : parseDuckDuckGo(html)
        }
      } catch {
        // API changes or malformed upstream payloads are recoverable via the next free source.
        continue
      }
      const anchor = strongSearchAnchor(request.query)
      if (anchor !== undefined) {
        sources = sources.filter(s => normalizeSearchText((s.title ?? '') + ' ' + (s.snippet ?? '') + ' ' + s.url).includes(anchor))
      }
      if (sources.length > 0) {
        const result = {
          sources: capSources(sources, request.maxResults),
          truncated: request.maxResults !== undefined && sources.length > request.maxResults,
        }
        this.queryCache.set(cacheKey, { expires: Date.now() + 30_000, result })
        if (this.queryCache.size > 128) this.queryCache.delete(this.queryCache.keys().next().value ?? cacheKey)
        return result
      }
    }
    throw new WebError('no free search engine returned results', 'WEB_PROVIDER_TRANSIENT')
  }

  private async fetchEngine(engine: FreeSearchEngine, query: string, signal?: AbortSignal): Promise<Response> {
    const endpoint = engine === 'bing' ? 'https://www.bing.com/search'
      : engine === 'duckduckgo' ? 'https://html.duckduckgo.com/html/'
      : 'https://es.wikipedia.org/w/api.php'
    const url = engine === 'wikipedia'
      ? `${endpoint}?action=query&list=search&format=json&srsearch=${encodeURIComponent(query)}&srlimit=10`
      : `${endpoint}?q=${encodeURIComponent(query).replace(/%20/g, '+')}`
    const controller = new AbortController()
    const timer = setTimeout(() =>{  controller.abort(new Error('free search timeout')) }, this.timeoutMs)
    const combined = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
    try {
      return await this.fetcher(url, { signal: combined, headers: { accept: engine === 'wikipedia' ? 'application/json' : 'text/html', 'user-agent': PHOENIX_USER_AGENT } })
    } catch (error) {
      if (signal?.aborted === true) throw signal.reason ?? error
      return new Response('', { status: 599 })
    } finally {
      clearTimeout(timer)
    }
  }
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
}

function strongSearchAnchor(query: string): string | undefined {
  const norm = normalizeSearchText(query)
  if (/\bartemis\b/u.test(norm)) return 'artemis'
  if (/\bdengue\b/u.test(norm)) return 'dengue'
  return undefined
}

function isChallengePage(html: string): boolean {
  const excerpt = html.slice(0, 16_000)
  return /(?:<title[^>]*>\s*(?:just a moment|access denied|captcha|verify you are human)|cf-chl-|g-recaptcha|hcaptcha|data-sitekey=|verify (?:you are|that you) (?:a )?human|automated traffic|unusual traffic)/iu.test(excerpt)
}

function parseWikipedia(raw: unknown): WebSearchSource[] {
  if (typeof raw !== 'object' || raw === null || !('query' in raw)) return []
  const query = (raw as { query?: { search?: unknown } }).query
  if (!Array.isArray(query?.search)) return []
  return query.search.flatMap((item: unknown): WebSearchSource[] => {
    if (typeof item !== 'object' || item === null || !('title' in item) || typeof item.title !== 'string') return []
    const entry = item as { title: string; snippet?: string }
    return [{
      url: `https://es.wikipedia.org/wiki/${encodeURIComponent(entry.title.replace(/ /gu, '_'))}`,
      title: entry.title,
      ...(entry.snippet === undefined ? {} : { snippet: stripHtml(entry.snippet) }),
    }]
  })
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
      url: normalizeDuckDuckGoUrl(decodeHtml(match[1] ?? '')),
      title: stripHtml(match[2] ?? ''),
      ...(match[3] === undefined ? {} : { snippet: stripHtml(match[3]) }),
    })
  }
  return sources.filter(source => isHttpUrl(source.url))
}

/**
 * Decode DuckDuckGo outbound links, which often use protocol-relative URLs
 * and a URL-encoded uddg target. Never return the search-engine redirect as a citation.
 */
function normalizeDuckDuckGoUrl(raw: string): string {
  try {
    const url = new URL(raw, 'https://duckduckgo.com')
    if (url.hostname === 'duckduckgo.com' || url.hostname.endsWith('.duckduckgo.com')) {
      const destination = url.searchParams.get('uddg')
      return destination && isHttpUrl(destination) ? destination : ''
    }
    return isHttpUrl(url.toString()) ? url.toString() : ''
  } catch { return '' }
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
  return value.replace(/&#(x[0-9a-f]+|\d+);/giu, (match, digits: string) => {
    const number = digits.toLowerCase().startsWith('x') ? Number.parseInt(digits.slice(1), 16) : Number.parseInt(digits, 10)
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : match
  }).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}
