/** SearXNG-backed implementation of the provider-neutral PHOENIX web-search seam. */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'

/** Stable id registered in `ctx.web`. */
export const SEARXNG_SEARCH_PROVIDER_ID = 'searxng'
/** Local/self-hosted default. Override with PHOENIX_SEARXNG_URL or Settings. */
export const SEARXNG_SEARCH_DEFAULT_BASE_URL = 'http://127.0.0.1:8888'

const USER_AGENT = 'phoenix-harness/0.1.1'

export interface SearxngSearchProviderOptions {
  readonly baseURL: string
}

interface SearxngResult {
  url?: unknown
  title?: unknown
  content?: unknown
  publishedDate?: unknown
  published_date?: unknown
}

interface SearxngResponse {
  results?: unknown
}

/** Normalize one SearXNG result without inventing unavailable metadata. */
export function mapSearxngResult(result: SearxngResult): WebSearchSource | undefined {
  if (typeof result.url !== 'string' || result.url.length === 0 || !URL.canParse(result.url)) return undefined
  const publishedAt = typeof result.publishedDate === 'string'
    ? result.publishedDate
    : typeof result.published_date === 'string' ? result.published_date : undefined
  return {
    url: result.url,
    ...typeof result.title === 'string' && result.title.length > 0 ? { title: result.title } : {},
    ...typeof result.content === 'string' && result.content.length > 0 ? { snippet: result.content } : {},
    ...publishedAt === undefined || publishedAt.length === 0 ? {} : { publishedAt },
  }
}

/** Parse and normalize SearXNG's JSON API response. */
export function mapSearxngResponse(response: SearxngResponse): WebSearchResult {
  if (!Array.isArray(response.results)) {
    throw new WebError('SearXNG returned an invalid results payload', 'WEB_PROVIDER_ERROR')
  }
  const seen = new Set<string>()
  const sources = response.results.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const source = mapSearxngResult(entry as SearxngResult)
    if (source === undefined || seen.has(source.url)) return []
    seen.add(source.url)
    return [source]
  })
  return { sources, truncated: false }
}

/** Keyless SearXNG provider. PHOENIX owns the tool; the selected LLM is irrelevant. */
export class SearxngSearchProvider implements WebSearchProvider {
  readonly id = SEARXNG_SEARCH_PROVIDER_ID

  constructor(private readonly resolveOptions: () => SearxngSearchProviderOptions) {}

  available(): boolean {
    return URL.canParse(this.resolveOptions().baseURL)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions()
    let endpoint: URL
    try {
      endpoint = new URL('/search', normalizedBase(options.baseURL))
      endpoint.searchParams.set('q', request.query)
      endpoint.searchParams.set('format', 'json')
      endpoint.searchParams.set('safesearch', '0')
    } catch (error: unknown) {
      throw new WebError(`SearXNG base URL is invalid: ${String(error)}`, 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE', { cause: error })
    }
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'GET',
        redirect: 'error',
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        ...signal === undefined ? {} : { signal },
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
      throw new WebError(
        `SearXNG search failed at ${endpoint.origin}; start the PHOENIX local search service or configure PHOENIX_SEARXNG_URL`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }
    if (!response.ok) {
      throw new WebError(`SearXNG search failed (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR')
    }
    try {
      return mapSearxngResponse(await response.json() as SearxngResponse)
    } catch (error: unknown) {
      if (error instanceof WebError) throw error
      if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
      throw new WebError(`SearXNG returned an unprocessable response: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

function normalizedBase(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

function aborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('SearXNG search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
