import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@phoenix-ai/dsh-web'
import { FreeSearchProvider, type FreeSearchEngine } from './provider.ts'

export { FREE_SEARCH_PROVIDER_ID, FreeSearchProvider } from './provider.ts'
export type { FreeSearchEngine, FreeSearchFetcher, FreeSearchProviderOptions } from './provider.ts'

export const name = 'web-search-free'
export const inject = ['web']

/** Cordis configuration for the keyless search provider. */
export interface Config {
  /** Ordered public HTML engines; defaults to Bing followed by DuckDuckGo. */
  engines?: FreeSearchEngine[]
  /** Per-engine request timeout in milliseconds. */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  engines: z.array(z.union(['bing', 'duckduckgo'] as const)),
  timeoutMs: z.number().step(1).min(1),
})

export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new FreeSearchProvider(config))
}
