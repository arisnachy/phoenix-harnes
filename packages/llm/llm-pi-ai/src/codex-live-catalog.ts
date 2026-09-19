/**
 * Safe live-catalog projection for the ChatGPT-authenticated Codex route.
 *
 * The Codex app-server is authoritative for account-visible model ids, while
 * Phoenix settings remain authoritative for an explicit non-empty model list.
 * This module contains only the deterministic policy/projection; refresh
 * cadence and last-good caching stay in the plugin lifecycle.
 *
 * @module dsh-llm-pi-ai/codex-live-catalog
 */

import { THINKING_LEVELS } from './catalog.ts'
import type { PiAiModelProfile, PiAiProviderProfile, PiAiReasoningEfforts } from './config.ts'
import type { CodexDiscoveredModel } from './codex-discovery.ts'

/** Provider route whose account-scoped catalog is owned by Codex app-server. */
export const CODEX_PROVIDER = 'openai-codex'

/** Avoid repeatedly spawning Codex while keeping selector data reasonably fresh. */
export const CODEX_MODEL_REFRESH_INTERVAL_MS = 60_000

const SUPPORTED_THINKING_LEVELS = new Set<string>(THINKING_LEVELS)

/**
 * Whether Phoenix may overlay the live Codex catalog on this route.
 *
 * A non-empty configured list is an explicit human pin and always wins.
 * Schemastery may materialize an omitted array as [], so empty and absent are
 * both treated as "automatic".
 */
export function codexCatalogIsAutomatic(profile: PiAiProviderProfile | undefined): profile is PiAiProviderProfile {
  return profile !== undefined && (profile.models === undefined || profile.models.length === 0)
}

/**
 * Translate Codex's live account catalog into the profile vocabulary pi-ai
 * can materialize today. Unknown future reasoning levels are deliberately
 * ignored instead of crashing the whole selector; the model itself remains
 * selectable and a future pi-ai upgrade can expose the new level.
 */
export function codexModelsToProfiles(models: readonly CodexDiscoveredModel[]): PiAiModelProfile[] {
  return models.map((model) => {
    const reasoningEfforts: PiAiReasoningEfforts = {}
    for (const effort of model.reasoning?.efforts ?? []) {
      if (!SUPPORTED_THINKING_LEVELS.has(effort.id)) continue
      reasoningEfforts[effort.id as keyof PiAiReasoningEfforts] = effort.id === 'off' ? null : effort.id
    }
    const hasThinking = Object.keys(reasoningEfforts).some(level => level !== 'off')
    return {
      id: model.id,
      ...model.name === undefined ? {} : { name: model.name },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
      ...hasThinking ? { reasoningEfforts } : {},
    }
  })
}
