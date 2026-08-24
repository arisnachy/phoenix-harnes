/** Registers keyless SearXNG search in the provider-neutral PHOENIX web seam. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-web'
import {
  SearxngSearchProvider,
  SEARXNG_SEARCH_DEFAULT_BASE_URL,
} from './provider.ts'

export {
  SearxngSearchProvider,
  SEARXNG_SEARCH_DEFAULT_BASE_URL,
  SEARXNG_SEARCH_PROVIDER_ID,
  mapSearxngResult,
  mapSearxngResponse,
} from './provider.ts'
export type { SearxngSearchProviderOptions } from './provider.ts'

export const name = 'web-search-searxng'
export const inject = ['web']
export const WEB_SEARCH_SEARXNG_SETTINGS_NAMESPACE = settingsNamespace('web-search-searxng')

export interface Config {
  /** Self-hosted endpoint. No API key or model-provider credential is required. */
  baseURL?: string
}

export const Config: z<Config> = z.object({
  baseURL: z.string().default(SEARXNG_SEARCH_DEFAULT_BASE_URL),
})

/** Register the provider and its live settings section. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, WEB_SEARCH_SEARXNG_SETTINGS_NAMESPACE, Config, config, {
    setSource: source => { current = source },
    onChange: () => {},
  })
  ctx.web.registerSearchProvider(new SearxngSearchProvider(() => ({
    baseURL: process.env.PHOENIX_SEARXNG_URL ?? current().baseURL ?? SEARXNG_SEARCH_DEFAULT_BASE_URL,
  })))
}
