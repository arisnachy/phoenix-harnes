/**
 * Runtime bridge from Codex's account-scoped model/list catalog to pi-ai.
 *
 * The Settings discovery seam already asks Codex app-server for the live
 * catalog, but runtime selectors and exact model resolution historically kept
 * using the bundled pi-ai snapshot. This module keeps a short-lived live
 * catalog and materializes a descriptor for a newly advertised Codex model so
 * it can be selected immediately without writing model ids into settings.
 *
 * @module dsh-llm-pi-ai/codex-runtime-catalog
 */

import type { Api, Model, ModelThinkingLevel } from '@earendil-works/pi-ai'
import { LlmError } from '@phoenix-ai/dsh-llm'
import type { LlmDiscoveredModel } from '@phoenix-ai/dsh-llm'
import type { ResolvedPiAiProviderProfile } from './config.ts'

/** Avoid repeatedly starting Codex app-server while a selector re-renders. */
export const CODEX_RUNTIME_CATALOG_TTL_MS = 15_000

/** Discovery metadata Codex contributes beyond the provider-neutral shape. */
export interface CodexRuntimeDiscoveredModel extends LlmDiscoveredModel {
  reasoning?: {
    efforts: Array<{ id: string; name: string; description?: string }>
    defaultEffort?: string
  }
}

const PI_REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const PI_REASONING_LEVEL_SET = new Set<string>(PI_REASONING_LEVELS)

type RuntimeReasoning = Pick<Model<Api>, 'reasoning'> & Partial<Pick<Model<Api>, 'thinkingLevelMap'>>

/** One cached account-visible catalog. */
interface CachedCatalog {
  checkedAt: number
  models: readonly CodexRuntimeDiscoveredModel[]
}

/**
 * Small stale-while-error cache around live Codex discovery.
 * Successful reads are reused briefly; a refresh failure keeps the last good
 * catalog instead of making a model picker disappear because one subprocess
 * launch failed. Before the first successful read, failures stay visible.
 */
export class CodexRuntimeCatalog {
  private cached: CachedCatalog | undefined

  constructor(
    private readonly discover: (signal?: AbortSignal) => Promise<readonly LlmDiscoveredModel[]>,
    private readonly ttlMs = CODEX_RUNTIME_CATALOG_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async list(signal?: AbortSignal): Promise<readonly CodexRuntimeDiscoveredModel[]> {
    const cached = this.cached
    if (cached !== undefined && this.now() - cached.checkedAt < this.ttlMs) return cached.models
    try {
      const models = await this.discover(signal) as readonly CodexRuntimeDiscoveredModel[]
      this.cached = { checkedAt: this.now(), models }
      return models
    } catch (error: unknown) {
      if (cached !== undefined) return cached.models
      throw error
    }
  }
}

/** Keep only pi-ai reasoning ids it can actually send on the Codex wire. */
function liveReasoning(
  candidate: CodexRuntimeDiscoveredModel,
  fallback: Model<Api>,
): RuntimeReasoning {
  const advertised = candidate.reasoning?.efforts
    .map(effort => effort.id)
    .filter((id): id is ModelThinkingLevel => PI_REASONING_LEVEL_SET.has(id))
  if (advertised === undefined || advertised.length === 0) {
    return {
      reasoning: fallback.reasoning,
      ...fallback.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: fallback.thinkingLevelMap },
    }
  }
  const supported = new Set(advertised)
  const thinkingLevelMap: NonNullable<Model<Api>['thinkingLevelMap']> = Object.fromEntries(
    PI_REASONING_LEVELS.map(level => [level, supported.has(level) ? level : null]),
  )
  return { reasoning: true, thinkingLevelMap }
}

/**
 * Turn one live Codex row into a pi-ai model descriptor.
 *
 * Exact bundled matches keep their authoritative capacities and compatibility.
 * A genuinely new id inherits only the Codex transport/compat scaffold from an
 * existing route model, while route fallbacks size fields Codex model/list does
 * not currently expose. The id/name and live reasoning capabilities remain the
 * account-scoped source of truth.
 */
export function materializeCodexRuntimeModel(
  profile: ResolvedPiAiProviderProfile,
  candidate: CodexRuntimeDiscoveredModel,
): Model<Api> {
  const baseline = profile.piProvider.getModels()
  const exact = baseline.find(model => model.id === candidate.id)
  const scaffold = exact
    ?? baseline.find(model => model.api === 'openai-codex-responses')
    ?? baseline[0]
  if (scaffold === undefined) {
    throw new LlmError(
      'openai-codex has no transport scaffold for a live-discovered model',
      'UNKNOWN_MODEL',
    )
  }
  const reasoning = liveReasoning(candidate, scaffold)
  return {
    ...scaffold,
    provider: profile.provider,
    id: candidate.id,
    name: candidate.name ?? candidate.id,
    contextWindow: candidate.contextWindow ?? exact?.contextWindow ?? profile.defaultContextWindow ?? scaffold.contextWindow,
    maxTokens: candidate.maxTokens ?? exact?.maxTokens ?? profile.defaultMaxTokens ?? scaffold.maxTokens,
    input: exact?.input ?? profile.defaultInput ?? scaffold.input,
    ...reasoning,
  }
}
