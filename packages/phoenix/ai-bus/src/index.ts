/**
 * PHOENIX AI Bus — provider-neutral cost-lane policy over the native DSH LLM
 * registry. It does not grant model authority; the capability ladder remains
 * the only PHOENIX authority gate.
 * @module @deepseek-ai/dsh-phoenix-ai-bus
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'

export type PhoenixComputeLane = 'local-free' | 'remote-free' | 'metered-or-unknown'

export interface PhoenixModelRef {
  provider: string
  model: string
}

export interface PhoenixRouteSnapshot extends PhoenixModelRef {
  name: string
  lane: PhoenixComputeLane
}

export interface PhoenixAiBusConfig {
  /** Provider route treated as local zero-marginal-cost compute. */
  localProvider?: string
  /** Gateway route whose explicitly free model ids are remote-free compute. */
  remoteFreeProvider?: string
}

export interface PiAiModelPreset {
  id: string
  name: string
  contextWindow?: number
  maxTokens?: number
  reasoningEfforts?: Record<string, string | null>
}

export interface PiAiProviderPreset {
  displayName: string
  api?: string
  baseURL: string
  apiKeyEnv?: string
  compat?: Record<string, string | boolean>
  models: PiAiModelPreset[]
}

/**
 * Conservative PHOENIX preset for OrcaRouter's free difficulty router.
 * The 32K output cap is intentionally below the upstream maximum to control
 * runaway token spend while preserving the verified 1M input context.
 */
export const ORCAROUTER_FREE_PROFILE: Readonly<PiAiProviderPreset> = Object.freeze({
  displayName: 'OrcaRouter Free',
  api: 'openai-completions',
  baseURL: 'https://api.orcarouter.ai/v1',
  apiKeyEnv: 'ORCAROUTER_API_KEY',
  compat: {
    thinkingFormat: 'deepseek',
    supportsDeveloperRole: false,
    maxTokensField: 'max_tokens',
  },
  models: [{
    id: 'orcarouter/free',
    name: 'OrcaRouter Free',
    contextWindow: 1_048_576,
    maxTokens: 32_768,
    reasoningEfforts: { off: null, high: 'high' },
  }],
})

/**
 * Build an Ollama OpenAI-compatible profile without inventing a local model.
 * The caller must name a model that actually exists in its Ollama catalog.
 */
export function createOllamaProfile(
  model: string,
  baseURL = 'http://127.0.0.1:11434/v1',
): PiAiProviderPreset {
  const trimmed = model.trim()
  if (trimmed.length === 0) throw new Error('PHOENIX Ollama profile requires an installed model id')
  return {
    displayName: 'Ollama Local',
    api: 'openai-completions',
    baseURL,
    compat: {
      supportsDeveloperRole: false,
      maxTokensField: 'max_tokens',
    },
    models: [{ id: trimmed, name: trimmed }],
  }
}

/** A free alias must say so explicitly; gateway membership alone is not free. */
export function isExplicitFreeModel(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  return normalized === 'orcarouter/free'
    || normalized.endsWith('-free')
    || normalized.endsWith('/free')
}

function providerMatches(provider: string, configured: string): boolean {
  return provider === configured || provider.startsWith(`${configured}-`)
}

const LANE_ORDER: Readonly<Record<PhoenixComputeLane, number>> = Object.freeze({
  'local-free': 0,
  'remote-free': 1,
  'metered-or-unknown': 2,
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    phoenixAiBus: PhoenixAiBus
  }
}

/**
 * Cost-lane view over models that are already registered with DSH. This class
 * deliberately never marks a model qualified, never calls providers, and never
 * mutates the agent's selected model. Authority remains in PHOENIX Runtime.
 */
export default class PhoenixAiBus extends Service {
  static inject = ['llm']

  static Config: z<PhoenixAiBusConfig> = z.object({
    localProvider: z.string().default('ollama'),
    remoteFreeProvider: z.string().default('orcarouter'),
  }) as z<PhoenixAiBusConfig>

  private readonly localProvider: string
  private readonly remoteFreeProvider: string

  constructor(ctx: Context, config: PhoenixAiBusConfig = {}) {
    super(ctx, 'phoenixAiBus')
    this.localProvider = (config.localProvider ?? 'ollama').trim()
    this.remoteFreeProvider = (config.remoteFreeProvider ?? 'orcarouter').trim()
    if (this.localProvider.length === 0) throw new Error('PHOENIX AI Bus localProvider must not be blank')
    if (this.remoteFreeProvider.length === 0) throw new Error('PHOENIX AI Bus remoteFreeProvider must not be blank')
  }

  /** Classify cost only; this says nothing about trust, quality, or authority. */
  laneOf(ref: PhoenixModelRef): PhoenixComputeLane {
    if (providerMatches(ref.provider, this.localProvider)) return 'local-free'
    if (providerMatches(ref.provider, this.remoteFreeProvider) && isExplicitFreeModel(ref.model)) return 'remote-free'
    return 'metered-or-unknown'
  }

  /** Stable cost ordering for a set already filtered by an authority gate. */
  orderByCost<T extends PhoenixModelRef>(refs: readonly T[]): T[] {
    return refs
      .map((ref, index) => ({ ref, index, rank: LANE_ORDER[this.laneOf(ref)] }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map(entry => entry.ref)
  }

  /** Observe the live native DSH registry without issuing any model request. */
  async snapshot(): Promise<PhoenixRouteSnapshot[]> {
    const result: PhoenixRouteSnapshot[] = []
    for (const provider of this.ctx.llm.listProviders()) {
      let models: readonly LlmModelInfo[]
      try {
        models = await this.ctx.llm.listModels(provider.id)
      } catch {
        continue
      }
      for (const model of models) {
        const ref = { provider: model.provider, model: model.id }
        result.push({ ...ref, name: model.name, lane: this.laneOf(ref) })
      }
    }
    return result
  }
}
