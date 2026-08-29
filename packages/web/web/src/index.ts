/**
 * Service Definition for the web access capability seam (`ctx.web`): registries and provider-selecting execution for search and
 * fetch. Duplicate ids are rejected. At execution time, a configured provider must exist and
 * be usable; without one, exactly one usable provider is required, so selection never depends
 * on registration order.
 * @module @phoenix-ai/dsh-web
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from './types.ts'
import { WebError } from './types.ts'

export {
  WebError,
} from './types.ts'
export type {
  WebFetchBody,
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    web: WebRuntime
  }
}

/** Selection inputs for execution-time provider resolution. */
interface Selection<P> {
  /** The configured provider id for this capability, if any. */
  readonly configuredId?: string
  /** Providers registered for this capability kind. */
  readonly providers: ReadonlyMap<string, P>
}

/**
 * Config for the web seam. `searchProvider` / `fetchProvider` pin which provider
 * wins for each capability; both are optional (a single registered usable
 * provider auto-selects). Operational overrides such as environment variables
 * must feed these same fields rather than introduce a hidden priority chain.
 */
export interface WebRuntimeConfig {
  /** Explicit search provider id. Omitted = auto-select when exactly one usable. */
  readonly searchProvider?: string
  /** Ordered search fallbacks used only after recoverable primary failures. */
  readonly searchFallbackProviders?: string[]
  /** Explicit fetch provider id. Omitted = auto-select when exactly one usable. */
  readonly fetchProvider?: string
}

/**
 * The web access service. Registered as `ctx.web` (one instance per context).
 *
 * Selection semantics (resolved at execution time, never order-dependent):
 * - A configured id that is registered and `available()` → that provider.
 * - A configured id not registered → `WEB_PROVIDER_CONFIGURED_MISSING`.
 * - A configured id registered but unavailable →
 *   `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`.
 * - No id configured, exactly one registered usable provider → that provider.
 * - No id configured, multiple usable providers → `WEB_PROVIDER_AMBIGUOUS`.
 * - No id configured, no usable provider → `WEB_PROVIDER_UNAVAILABLE`.
 */
export class WebRuntime extends Service {
  /**
   * Provider selection config. Operational env overrides feed the SAME fields:
   * `$DSH_WEB_SEARCH_PROVIDER` / `$DSH_WEB_FETCH_PROVIDER` are equivalent to
   * `searchProvider` / `fetchProvider` and are NOT a hidden priority chain.
   */
  static Config: z<WebRuntimeConfig> = z.object({
    searchProvider: z.string(),
    searchFallbackProviders: z.array(z.string()).default([]),
    fetchProvider: z.string(),
  })

  private searchProviders = new Map<string, WebSearchProvider>()
  private fetchProviders = new Map<string, WebFetchProvider>()
  private readonly searchProviderId: string | undefined
  private readonly searchFallbackProviderIds: readonly string[]
  private readonly fetchProviderId: string | undefined

  constructor(ctx: Context, config: WebRuntimeConfig = {}) {
    super(ctx, 'web')
    this.searchProviderId = config.searchProvider ?? process.env.DSH_WEB_SEARCH_PROVIDER
    this.searchFallbackProviderIds = config.searchFallbackProviders ?? parseProviderIds(process.env.DSH_WEB_SEARCH_FALLBACK_PROVIDERS)
    this.fetchProviderId = config.fetchProvider ?? process.env.DSH_WEB_FETCH_PROVIDER
  }

  /**
   * Register a search provider. Throws {@link WebError} `WEB_DUPLICATE_PROVIDER`
   * if its id is already registered for search. Returns a disposer; disposed
   * with the calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerSearchProvider(provider: WebSearchProvider): () => void {
    return this.registerProvider(this.searchProviders, provider)
  }

  /**
   * Register a fetch provider. Throws {@link WebError} `WEB_DUPLICATE_PROVIDER`
   * if its id is already registered for fetch. Returns a disposer; disposed
   * with the calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerFetchProvider(provider: WebFetchProvider): () => void {
    return this.registerProvider(this.fetchProviders, provider)
  }

  private registerProvider<P extends { readonly id: string }>(store: Map<string, P>, provider: P): () => void {
    if (store.has(provider.id)) {
      throw new WebError(`a web provider with id "${provider.id}" is already registered`, 'WEB_DUPLICATE_PROVIDER')
    }
    const dispose = this.ctx.effect(function* () {
      store.set(provider.id, provider)
      yield () => store.delete(provider.id)
    }, 'web.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is
    // synchronous fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /**
   * Run one search through the selected provider. Resolves the provider at call
   * time with the selection rules above; throws {@link WebError} when the
   * capability cannot run. The seam enforces `request.maxResults` on the result:
   * if the provider over-returns, `sources[]` is truncated and `truncated` set.
   * @param request - the query and optional result limit.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the provider's results, capped to `request.maxResults`.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const providers = resolveSearchProviders(this.searchProviders, this.searchProviderId, this.searchFallbackProviderIds)
    let lastRecoverable: unknown
    for (const provider of providers) {
      if (signal?.aborted === true) throw signal.reason ?? new WebError('web search was aborted', 'WEB_SEARCH_ABORTED')
      try {
        const result = await provider.search(request, signal)
        return capSources(result, request.maxResults)
      } catch (error) {
        if (!isRecoverableSearchError(error)) throw error
        lastRecoverable = error
      }
    }
    throw new WebError(
      `all configured web search providers failed recoverably: ${providers.map(provider => provider.id).join(', ')}`,
      'WEB_PROVIDER_FALLBACK_EXHAUSTED',
      { cause: lastRecoverable },
    )
  }

  /**
   * Retrieve one URL through the selected provider. Resolves the provider at
   * call time with the selection rules above; throws {@link WebError} when the
   * capability cannot run. A non-2xx response is a result, not a throw.
   * @param request - the URL plus retrieval options.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the retrieval outcome; non-2xx responses resolve descriptively.
   */
  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const provider = resolveProvider({
      providers: this.fetchProviders,
      ...this.fetchProviderId !== undefined ? { configuredId: this.fetchProviderId } : {},
    })
    return provider.fetch(request, signal)
  }
}

interface ResolvableProvider {
  readonly id: string
  available(): boolean
}

/** Resolve the selected provider or throw the matching {@link WebError}. */
function resolveProvider<P extends ResolvableProvider>(selection: Selection<P>): P {
  const { configuredId, providers } = selection
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (!provider) {
      throw new WebError(`configured web provider "${configuredId}" is not registered`, 'WEB_PROVIDER_CONFIGURED_MISSING')
    }
    if (!provider.available()) {
      throw new WebError(`configured web provider "${configuredId}" is registered but unavailable`, 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
    }
    return provider
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  const [single] = usable
  if (single === undefined) {
    throw new WebError('no usable web provider is registered', 'WEB_PROVIDER_UNAVAILABLE')
  }
  if (usable.length > 1) {
    const ids = usable.map(provider => provider.id).join(', ')
    throw new WebError(`multiple usable web providers are registered (${ids}); configure one explicitly`, 'WEB_PROVIDER_AMBIGUOUS')
  }
  return single
}

/** Provider failures that are safe to retry through a configured fallback. */
const RECOVERABLE_SEARCH_CODES = new Set([
  'WEB_PROVIDER_QUOTA',
  'WEB_PROVIDER_RATE_LIMIT',
  'WEB_PROVIDER_AUTH',
  'WEB_PROVIDER_TIMEOUT',
  'WEB_PROVIDER_UNAVAILABLE',
  'WEB_PROVIDER_CONFIGURED_UNAVAILABLE',
  'WEB_PROVIDER_TRANSIENT',
])

/** Resolve the configured primary followed by usable, explicitly ordered fallbacks. */
function resolveSearchProviders(
  providers: ReadonlyMap<string, WebSearchProvider>,
  configuredId: string | undefined,
  fallbackIds: readonly string[],
): WebSearchProvider[] {
  if (configuredId === undefined) return [resolveProvider({ providers })]
  const primary = providers.get(configuredId)
  if (primary === undefined) {
    throw new WebError(`configured web provider "${configuredId}" is not registered`, 'WEB_PROVIDER_CONFIGURED_MISSING')
  }
  const resolved = primary.available() ? [primary] : []
  for (const id of fallbackIds) {
    if (id === configuredId) continue
    const provider = providers.get(id)
    if (provider?.available() === true) resolved.push(provider)
  }
  if (resolved.length === 0) {
    throw new WebError(`configured web provider "${configuredId}" is registered but unavailable`, 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
  }
  return resolved
}

/** Return whether a provider failure can safely trigger the next search route. */
function isRecoverableSearchError(error: unknown): boolean {
  if (error instanceof WebError && RECOVERABLE_SEARCH_CODES.has(error.code)) return true
  if (error instanceof Error) {
    return /(?:credit|quota|rate.?limit|too many requests|timeout|temporar(?:y|ily)|unavailable|401|403|429)/i.test(error.message)
  }
  return false
}

function parseProviderIds(value: string | undefined): readonly string[] {
  return value === undefined ? [] : value.split(',').map(id => id.trim()).filter(Boolean)
}

/** Enforce `maxResults` on a search result: truncate `sources[]` and flag it. */
function capSources(result: WebSearchResult, maxResults: number | undefined): WebSearchResult {
  if (maxResults === undefined || result.sources.length <= maxResults) return result
  return { ...result, sources: result.sources.slice(0, maxResults), truncated: true }
}

export default WebRuntime
