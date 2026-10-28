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

/** Cancellable hedge timer so the backup never starts after a successful primary search. */
function hedgeDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
}

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

    // Give the primary a short head start; a stalled engine cannot serialize the fallback.
    const controller = new AbortController()
    const combined = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
    try {
      const attempts = this.engines.map(async (engine, index): Promise<WebSearchResult> => {
        if (index > 0) await hedgeDelay(Math.min(index, 2) * 350, combined)
        if (combined.aborted) throw combined.reason
        const sources = await this.fetchEngine(engine, request.query, combined)
        if (sources.length === 0) throw new WebError('search engine returned no results', 'WEB_PROVIDER_TRANSIENT')
        return {
          sources: capSources(sources, request.maxResults),
          truncated: request.maxResults !== undefined && sources.length > request.maxResults,
        }
      })
      const result = await Promise.any(attempts)
      if (signal?.aborted === true) throw signal.reason
      return result
    } catch {
      if (signal?.aborted === true) throw signal.reason ?? new WebError('web search was aborted', 'WEB_SEARCH_ABORTED')
      throw new WebError('no free search engine returned results', 'WEB_PROVIDER_TRANSIENT')
    } finally {
      controller.abort()
    }
  }

  private async fetchEngine(engine: FreeSearchEngine, query: string, signal: AbortSignal): Promise<WebSearchSource[]> {
    const endpoint = engine === 'bing' ? 'https://www.bing.com/search' : 'https://html.duckduckgo.com/html/'
    const url = `${endpoint}?q=${encodeURIComponent(query).replace(/%20/g, '+')}`
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort(new Error('free search timeout')) }, this.timeoutMs)
    const combined = AbortSignal.any([signal, controller.signal])
    try {
      const response = await this.fetcher(url, { signal: combined, headers: { accept: 'text/html' } })
      if (!response.ok) return []
      // Keep the deadline active through body consumption, not only the initial headers.
      const html = await response.text()
      if (combined.aborted) return []
      return engine === 'bing' ? parseBing(html) : parseDuckDuckGo(html)
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error
      return []
    } finally {
      clearTimeout(timer)
    }
  }
}

/** Read an HTML attribute without relying on a site's attribute ordering. */
function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27|([^\\s>]+))', 'i'))
  return match?.[1] ?? match?.[2] ?? match?.[3]
}

function parseBing(html: string): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  // Each result is parsed independently: a missing snippet must not consume the next result.
  const blocks = html.split(/(?=<li\b[^>]*class=["'][^"']*\bb_algo\b)/iu)
  for (const block of blocks) {
    if (!/^<li\b[^>]*class=["'][^"']*\bb_algo\b/iu.test(block)) continue
    const heading = block.slice(0, block.search(/<\/li>/iu) < 0 ? undefined : block.search(/<\/li>/iu))
      .match(/<h2\b[^>]*>[\s\S]*?<\/h2>/iu)?.[0]
    const anchor = heading?.match(/<a\b[^>]*>[\s\S]*?<\/a>/iu)?.[0]
    if (!anchor) continue
    const href = attribute(anchor, 'href')
    if (!href) continue
    const url = normalizeBingUrl(decodeHtml(href))
    if (!isHttpUrl(url)) continue
    const title = stripHtml(anchor.replace(/^<a\b[^>]*>/iu, '').replace(/<\/a>$/iu, ''))
    if (!title) continue
    const paragraph = block.match(/<p\b[^>]*>[\s\S]*?<\/p>/iu)?.[0]
    const snippet = paragraph ? stripHtml(paragraph) : ''
    sources.push({ url, title, ...(snippet ? { snippet } : {}) })
  }
  return sources
}

function normalizeDuckDuckGoUrl(raw: string): string {
  try {
    const url = new URL(raw, 'https://duckduckgo.com')
    if ((url.hostname === 'duckduckgo.com' || url.hostname === 'www.duckduckgo.com')
      && url.pathname.startsWith('/l/')) {
      return url.searchParams.get('uddg') ?? ''
    }
    return url.toString()
  } catch {
    return ''
  }
}

function parseDuckDuckGo(html: string): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  const anchors = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/giu)]
    .filter(entry => /\bresult__a\b/iu.test(attribute(entry[0], 'class') ?? ''))
  for (let index = 0; index < anchors.length; index++) {
    const entry = anchors[index]
    if (!entry) continue
    const tag = entry[0]
    const href = attribute(tag, 'href')
    if (!href) continue
    const url = normalizeDuckDuckGoUrl(decodeHtml(href))
    if (!isHttpUrl(url)) continue
    const title = stripHtml(tag.replace(/^<a\b[^>]*>/iu, '').replace(/<\/a>$/iu, ''))
    if (!title) continue
    let snippet = ''
    // Only inspect markup before the next result title to prevent cross-result snippets.
    const nextTitle = anchors[index + 1]
    const start = entry.index + tag.length
    const end = nextTitle?.index ?? html.length
    const between = html.slice(start, Math.min(end, start + 3000))
    const match = between.match(/<(?:a|div)\b[^>]*class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>[\s\S]*?<\/(?:a|div)>/iu)
    if (match) snippet = stripHtml(match[0])
    sources.push({ url, title, ...(snippet ? { snippet } : {}) })
  }
  return sources
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
  return value.replace(/&amp;/giu, '&').replace(/&quot;/giu, '"').replace(/&#(?:39|x27);/giu, "'")
    .replace(/&lt;/giu, '<').replace(/&gt;/giu, '>').replace(/&nbsp;/giu, ' ')
    .replace(/&#(x[0-9a-f]+|[0-9]+);/giu, (_whole, encoded: string) => {
      const code = encoded.startsWith('x') || encoded.startsWith('X')
        ? Number.parseInt(encoded.slice(1), 16) : Number.parseInt(encoded, 10)
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code) : ' '
    })
}
