/** Registers OpenRouter server-tool search in the provider-neutral PHOENIX web seam. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@phoenix-ai/dsh-agent'
import { credentialRef } from '@phoenix-ai/dsh-credentials'
import { launchEnvironmentOf } from '@phoenix-ai/dsh-launch-environment'
import { installSettingsSection, settingsNamespace } from '@phoenix-ai/dsh-settings'
import type {} from '@phoenix-ai/dsh-session'
import type {} from '@phoenix-ai/dsh-web'
import {
  OpenRouterSearchProvider,
  OPENROUTER_SEARCH_DEFAULT_BASE_URL,
  OPENROUTER_SEARCH_DEFAULT_MODEL,
} from './provider.ts'
import type { OpenRouterSearchProviderOptions } from './provider.ts'

export {
  OpenRouterSearchProvider,
  OPENROUTER_SEARCH_DEFAULT_BASE_URL,
  OPENROUTER_SEARCH_DEFAULT_MODEL,
  OPENROUTER_SEARCH_PROVIDER_ID,
  mapOpenRouterCitation,
  mapOpenRouterResponse,
} from './provider.ts'
export type { OpenRouterSearchProviderOptions } from './provider.ts'

/** Cordis plugin name. */
export const name = 'web-search-openrouter'
/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'OPENROUTER_API_KEY'
/** Settings namespace for search model, endpoint, and credential reference. */
export const WEB_SEARCH_OPENROUTER_SETTINGS_NAMESPACE = settingsNamespace('web-search-openrouter')

/** User-editable OpenRouter search settings. */
export interface Config {
  /** Literal key for controlled deployments; prefer apiKeyEnv. */
  apiKey?: string
  /** Credential reference shared with the OpenRouter model provider. */
  apiKeyEnv?: string
  /** OpenRouter API base. */
  baseURL?: string
  /** Model that receives the server-tool request. */
  model?: string
}

/* jscpd:ignore-start -- provider adapters intentionally share the web-search configuration shape */
export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  model: z.string().default(OPENROUTER_SEARCH_DEFAULT_MODEL),
})
/* jscpd:ignore-end */

/* jscpd:ignore-start -- provider adapters intentionally share the web-search registration shape */
function resolveOptions(ctx: Context, config: Config): OpenRouterSearchProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literal = config.apiKey !== undefined && config.apiKey.length > 0 ? config.apiKey : undefined
  return {
    ...literal === undefined ? {} : { apiKey: literal },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      return launchEnvironmentOf(ctx).get(apiKeyEnv)?.value
    },
    apiKeyEnv,
    baseURL: config.baseURL ?? OPENROUTER_SEARCH_DEFAULT_BASE_URL,
    model: config.model ?? OPENROUTER_SEARCH_DEFAULT_MODEL,
  }
}

/** Register the provider and its live settings section. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, WEB_SEARCH_OPENROUTER_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => { current = source },
    onChange: () => {},
  })
  ctx.web.registerSearchProvider(new OpenRouterSearchProvider(() => resolveOptions(ctx, current())))
}
/* jscpd:ignore-end */
