/**
 * Runtime overlay for the account-scoped Codex model catalog.
 *
 * Codex model availability changes independently of the installed pi-ai
 * dependency. This module turns a fresh Codex `model/list` answer into the
 * effective `openai-codex` profile without persisting generated rows back to
 * settings. Explicit user tuning wins field by field, while newly advertised
 * model ids join automatically.
 *
 * @module dsh-llm-pi-ai/codex-live-catalog
 */

import type { LlmDiscoveredModel } from '@phoenix-ai/dsh-llm'
import type { Config, PiAiProviderProfile } from './config.ts'
import type { PiAiModelProfile, PiAiReasoningEfforts } from './catalog.ts'
import { THINKING_LEVELS } from './catalog.ts'

/** Codex-only metadata carried by its live model/list mapper. */
interface CodexDiscoveredModel extends LlmDiscoveredModel {
  reasoning?: {
    efforts: Array<{ id: string; name: string; description?: string }>
    defaultEffort?: string
  }
}

/** Stable pi-ai provider id for ChatGPT-authenticated Codex. */
export const CODEX_PROVIDER = 'openai-codex'

const supportedThinking = new Set<string>(THINKING_LEVELS)

/** Translate live Codex reasoning metadata into levels the installed pi-ai can dispatch. */
function reasoningEffortsOf(model: CodexDiscoveredModel): PiAiReasoningEfforts | undefined {
  const result: PiAiReasoningEfforts = {}
  for (const effort of model.reasoning?.efforts ?? []) {
    if (!supportedThinking.has(effort.id)) continue
    const level = effort.id as keyof PiAiReasoningEfforts
    result[level] = effort.id === 'off' ? null : effort.id
  }
  // A declaration containing only `off` is not a useful reasoning capability
  // and config resolution deliberately refuses it. Keep the installed/default
  // behavior instead until Codex advertises at least one runnable thinking level.
  return Object.keys(result).some(level => level !== 'off') ? result : undefined
}

/** Convert one account-visible Codex model into the pi-ai profile vocabulary. */
function discoveredProfile(model: CodexDiscoveredModel): PiAiModelProfile {
  const reasoningEfforts = reasoningEffortsOf(model)
  return {
    id: model.id,
    ...model.name === undefined ? {} : { name: model.name },
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    ...reasoningEfforts === undefined ? {} : { reasoningEfforts },
  }
}

/** Merge user-owned model fields over an automatically discovered entry. */
function mergeModel(base: PiAiModelProfile | undefined, override: PiAiModelProfile): PiAiModelProfile {
  return { ...base, ...override, id: override.id }
}

/**
 * Apply a live Codex catalog to the effective runtime config.
 *
 * The overlay is intentionally conditional on an already configured
 * `openai-codex` route: installing the Codex CLI must not silently activate a
 * provider or change the user's provider topology. An empty discovery answer is
 * also ignored so a transient Codex failure cannot erase the last serviceable
 * catalog. Model overrides and explicit model rows are folded into the live
 * list; those user-owned fields win while live-only ids remain available.
 *
 * @param config - current resolved plugin configuration source.
 * @param discovered - current visible Codex account catalog.
 * @returns `config` itself when no overlay applies, otherwise a detached
 * effective configuration for runtime resolution only.
 */
export function withCodexLiveCatalog(
  config: Config,
  discovered: readonly CodexDiscoveredModel[],
): Config {
  const providers = config.providers
  const route = providers?.[CODEX_PROVIDER]
  if (route === undefined || discovered.length === 0) return config

  const models = new Map<string, PiAiModelProfile>()
  for (const model of discovered) models.set(model.id, discoveredProfile(model))

  for (const [id, override] of Object.entries(route.modelOverrides ?? {})) {
    models.set(id, mergeModel(models.get(id), { id, ...override }))
  }
  for (const model of route.models ?? []) {
    models.set(model.id, mergeModel(models.get(model.id), model))
  }

  const { models: _configuredModels, modelOverrides: _configuredOverrides, ...rest } = route
  const effectiveRoute: PiAiProviderProfile = {
    ...rest,
    models: [...models.values()],
  }
  return {
    ...config,
    providers: {
      ...providers,
      [CODEX_PROVIDER]: effectiveRoute,
    },
  }
}
