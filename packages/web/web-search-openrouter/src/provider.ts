/** OpenRouter-backed implementation of the provider-neutral PHOENIX web-search seam. */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import type { OpenRouterErrorResponse, OpenRouterSearchResponse, OpenRouterUrlCitation } from './types.ts'

/** Stable id registered in `ctx.web`. */
export const OPENROUTER_SEARCH_PROVIDER_ID = 'openrouter'
/** Public OpenRouter API base. */
export const OPENROUTER_SEARCH_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
/** Provider-neutral router used when the user has not selected a search model. */
export const OPENROUTER_SEARCH_DEFAULT_MODEL = 'openrouter/auto'

const USER_AGENT = 'phoenix-harness/0.1.1'

/** Fully resolved options for one search operation. */
export interface OpenRouterSearchProviderOptions {
  readonly apiKey?: string
  readonly resolveApiKey?: () => Promise<string | undefined>
  readonly apiKeyEnv?: string
  readonly baseURL: string
  readonly model: string
}

/**
 * Convert a standardized OpenRouter URL annotation into a citeable seam source.
 * @param annotation - OpenRouter URL citation annotation.
 * @returns Provider-neutral source, or undefined when its URL is invalid.
 */
export function mapOpenRouterCitation(annotation: OpenRouterUrlCitation): WebSearchSource | undefined {
  const citation = annotation.url_citation
  if (citation.url.length === 0 || !URL.canParse(citation.url)) return undefined
  return {
    url: citation.url,
    ...citation.title === undefined || citation.title.length === 0 ? {} : { title: citation.title },
    ...citation.content === undefined || citation.content.length === 0 ? {} : { snippet: citation.content },
  }
}

/**
 * Normalize one OpenRouter response, deduplicating citations by URL.
 * @param response - Parsed OpenRouter Chat Completions response.
 * @returns Provider-neutral search result with normalized citations.
 */
export function mapOpenRouterResponse(response: OpenRouterSearchResponse): WebSearchResult {
  const message = response.choices?.[0]?.message
  const seen = new Set<string>()
  const sources = (message?.annotations ?? []).flatMap((annotation) => {
    const source = mapOpenRouterCitation(annotation)
    if (source === undefined || seen.has(source.url)) return []
    seen.add(source.url)
    return [source]
  })
  return {
    ...message?.content == null || message.content.length === 0 ? {} : { content: message.content },
    sources,
    truncated: false,
  }
}

/** OpenRouter server-tool search provider; credentials are resolved per request. */
export class OpenRouterSearchProvider implements WebSearchProvider {
  readonly id = OPENROUTER_SEARCH_PROVIDER_ID

  constructor(private readonly resolveOptions: () => OpenRouterSearchProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions()
    return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
      && URL.canParse(options.baseURL)
      && options.model.length > 0
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions()
    const apiKey = await this.resolveCredential(options, signal)
    throwIfAborted(signal)
    const endpoint = `${options.baseURL.replace(/\/$/u, '')}/chat/completions`
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': USER_AGENT,
          'x-title': 'PHOENIX HARDNESS',
        },
        body: JSON.stringify({
          model: options.model,
          messages: [{
            role: 'user',
            content: `Search the web for: ${request.query}. Return a concise answer grounded only in cited sources.`,
          }],
          tools: [{
            type: 'openrouter:web_search',
            parameters: {
              engine: 'auto',
              ...request.maxResults === undefined ? {} : {
                max_results: request.maxResults,
                max_total_results: request.maxResults,
              },
            },
          }],
        }),
        ...signal === undefined ? {} : { signal },
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
      throw new WebError(`OpenRouter search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    /* jscpd:ignore-start -- all HTTP search adapters normalize provider errors at this boundary */
    if (!response.ok) {
      let message = `OpenRouter API error (HTTP ${response.status})`
      try {
        const parsed = await response.json() as OpenRouterErrorResponse
        const detail = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }
    /* jscpd:ignore-end */
    try {
      return mapOpenRouterResponse(await response.json() as OpenRouterSearchResponse)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
      throw new WebError(`OpenRouter returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  private async resolveCredential(options: OpenRouterSearchProviderOptions, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    let resolved: string | undefined
    try {
      resolved = await options.resolveApiKey?.()
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
      throw new WebError(`OpenRouter search credential resolution failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    throwIfAborted(signal)
    if (resolved !== undefined && resolved.length > 0) return resolved
    throw new WebError(
      `OpenRouter search has no API key for "${options.apiKeyEnv ?? 'OPENROUTER_API_KEY'}"; add it in Settings > Models`,
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw aborted(signal)
}

function aborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('OpenRouter search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
