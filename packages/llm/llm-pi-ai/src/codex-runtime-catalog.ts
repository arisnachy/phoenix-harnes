/**
 * Runtime bridge from Codex's account-scoped model/list catalog to pi-ai.
 *
 * The Settings discovery seam already asks Codex app-server for the live
 * catalog, but runtime selectors and exact model resolution historically kept
 * using the bundled pi-ai snapshot. This module keeps the last successful live
 * catalog and materializes a descriptor for a newly advertised Codex model so
 * it can be selected immediately without writing model ids into settings.
 *
 * Freshness follows real demand instead of a timer: every selector listing
 * refreshes the account catalog, while exact lookup reuses a model already
 * learned from a successful listing and refreshes only when an id is unknown.
 * Concurrent selector refreshes share one app-server request.
 *
 * @module dsh-llm-pi-ai/codex-runtime-catalog
 */

import type { Api, Model, ModelThinkingLevel } from '@earendil-works/pi-ai'
import { LlmError } from '@phoenix-ai/dsh-llm'
import type { LlmDiscoveredModel } from '@phoenix-ai/dsh-llm'
import type { ResolvedPiAiProviderProfile } from './config.ts'

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

/**
 * Last-good live catalog with demand-driven refresh.
 *
 * Selector listings are precise freshness signals, so they interrogate Codex
 * whenever they are requested rather than waiting for a fixed polling/TTL
 * interval. Concurrent selector reads share one no-signal discovery request.
 * Exact model lookup first checks the last-good catalog; a live-only model
 * therefore stays cheap on later turns, while a previously unseen id triggers
 * one fresh discovery. A refresh failure retains the last-good catalog so one
 * failed subprocess launch cannot make a working picker disappear.
 */
export class CodexRuntimeCatalog {
  private cached: readonly CodexRuntimeDiscoveredModel[] | undefined
  private inFlight: Promise<readonly CodexRuntimeDiscoveredModel[]> | undefined

  constructor(
    private readonly discover: (signal?: AbortSignal) => Promise<readonly LlmDiscoveredModel[]>,
  ) {}

  /** Run one live discovery, retaining the last successful non-empty answer. */
  private async refresh(signal?: AbortSignal): Promise<readonly CodexRuntimeDiscoveredModel[]> {
    const previous = this.cached
    try {
      const models = await this.discover(signal) as readonly CodexRuntimeDiscoveredModel[]
      if (models.length === 0) {
        throw new LlmError('Codex model/list returned an empty live catalog', 'DISCOVERY_FAILED')
      }
      this.cached = models
      return models
    } catch (error: unknown) {
      if (signal?.aborted) throw error
      if (previous !== undefined) return previous
      throw error
    }
  }

  /**
   * Refresh and return the account-visible Codex catalog.
   *
   * Calls without a cancellation signal may come from the same selector render
   * fan-out, so they share one in-flight app-server request. Signal-bearing
   * calls stay independent so one caller's cancellation cannot abort another.
   *
   * @param signal - Optional cancellation signal forwarded to live discovery.
   * @returns The refreshed live catalog, or the last good catalog after a refresh failure.
   */
  async list(signal?: AbortSignal): Promise<readonly CodexRuntimeDiscoveredModel[]> {
    if (signal !== undefined) return this.refresh(signal)
    if (this.inFlight !== undefined) return this.inFlight
    const request = this.refresh()
    this.inFlight = request
    try {
      return await request
    } finally {
      if (this.inFlight === request) this.inFlight = undefined
    }
  }

  /**
   * Resolve one live Codex id cheaply after it has already been discovered.
   * A cache miss is also a freshness signal: refresh once, then search again.
   *
   * @param id - Exact Codex model id.
   * @param signal - Optional request cancellation signal.
   * @returns The live model row, or undefined when Codex does not advertise it.
   */
  async find(id: string, signal?: AbortSignal): Promise<CodexRuntimeDiscoveredModel | undefined> {
    const known = this.cached?.find(model => model.id === id)
    if (known !== undefined) return known
    return (await this.list(signal)).find(model => model.id === id)
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
 *
 * @param profile - Resolved OpenAI Codex route used as the transport scaffold.
 * @param candidate - One model returned by the account-scoped Codex catalog.
 * @returns A pi-ai model descriptor that can be resolved and streamed immediately.
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
