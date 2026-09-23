/**
 * Safe live-catalog policy for the ChatGPT-authenticated Codex route.
 *
 * Codex app-server is authoritative for what the account should see in a
 * selector. Phoenix keeps a separate dispatch superset so a model disappearing
 * from the picker cannot invalidate an already-selected session. Explicit
 * non-empty settings lists remain human-owned and are never overlaid.
 *
 * @module dsh-llm-pi-ai/codex-live-catalog
 */

import { ReasoningEffortId } from '@phoenix-ai/dsh-llm'
import type { LlmModelReasoningInfo } from '@phoenix-ai/dsh-llm'
import { deepEqualJson } from '@phoenix-ai/dsh-settings'
import { catalogModels, THINKING_LEVELS } from './catalog.ts'
import type { PiAiModelProfile, PiAiProviderProfile, PiAiReasoningEfforts } from './config.ts'
import { codexModelListTransport } from './codex-discovery.ts'
import type { CodexDiscoveredModel, CodexModelListTransport } from './codex-discovery.ts'

/** Provider route whose account-scoped catalog is owned by Codex app-server. */
export const CODEX_PROVIDER = 'openai-codex'

/** Avoid repeatedly spawning Codex while keeping selector data reasonably fresh. */
export const CODEX_MODEL_REFRESH_INTERVAL_MS = 60_000

const SUPPORTED_THINKING_LEVELS = new Set<string>(THINKING_LEVELS)

/**
 * Whether Phoenix may overlay the live Codex catalog on this route.
 * Schemastery may materialize an omitted array as [], so empty and absent both
 * mean automatic; a non-empty list is an explicit human pin.
 *
 * @param profile - Provider settings currently active for the Codex route.
 * @returns True only when the route exists and does not pin a non-empty model list.
 */
export function codexCatalogIsAutomatic(profile: PiAiProviderProfile | undefined): boolean {
  return profile !== undefined && (profile.models === undefined || profile.models.length === 0)
}

/**
 * Translate Codex account metadata into the fixed reasoning vocabulary pi-ai
 * can materialize today. Exact Codex reasoning metadata is retained separately
 * by CodexLiveCatalog; this profile map is only the transport bridge.
 *
 * Known pi-ai levels keep their identity. If a new Codex model exposes only
 * future effort names, one ordinary pi-ai level is installed as a carrier so
 * the model remains reasoning-capable at dispatch time. The adapter replaces
 * that carrier with the exact Codex effort in the final request payload.
 *
 * @param models - Account-visible models returned by Codex app-server.
 * @returns Pi-ai model profiles safe to materialize in the current runtime.
 */
export function codexModelsToProfiles(models: readonly CodexDiscoveredModel[]): PiAiModelProfile[] {
  return models.map((model) => {
    const reasoningEfforts: PiAiReasoningEfforts = {}
    const discoveredEfforts = model.reasoning?.efforts ?? []
    for (const effort of discoveredEfforts) {
      if (!SUPPORTED_THINKING_LEVELS.has(effort.id)) continue
      reasoningEfforts[effort.id as keyof PiAiReasoningEfforts] = effort.id === 'off' ? null : effort.id
    }

    let hasThinking = Object.keys(reasoningEfforts).some(level => level !== 'off')
    if (!hasThinking) {
      const futureEffort = discoveredEfforts.find(effort => effort.id !== 'off')
      if (futureEffort !== undefined) {
        // "high" is a carrier only. The selector never sees it unless Codex
        // actually advertised it; the final Codex payload is rewritten to the
        // exact future effort string before transport.
        reasoningEfforts.high = futureEffort.id
        hasThinking = true
      }
    }

    return {
      id: model.id,
      ...model.name === undefined ? {} : { name: model.name },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
      ...hasThinking ? { reasoningEfforts } : {},
    }
  })
}

/** Convert authoritative Codex reasoning metadata into the Harness vocabulary. */
function reasoningInfoOf(model: CodexDiscoveredModel): LlmModelReasoningInfo | undefined {
  const reasoning = model.reasoning
  if (reasoning === undefined || reasoning.efforts.length === 0) return undefined
  const efforts = reasoning.efforts.map(effort => ({
    id: ReasoningEffortId(effort.id),
    name: effort.name,
    ...effort.description === undefined ? {} : { description: effort.description },
  }))
  const ids = new Set(efforts.map(effort => effort.id as string))
  const defaultEffort = reasoning.defaultEffort !== undefined && ids.has(reasoning.defaultEffort)
    ? ReasoningEffortId(reasoning.defaultEffort)
    : undefined
  return {
    efforts,
    ...defaultEffort === undefined ? {} : { defaultEffort },
  }
}

/** Dependencies and policy knobs for one live Codex catalog instance. */
export interface CodexLiveCatalogOptions {
  /** Injectable app-server seam for deterministic tests. */
  transport?: CodexModelListTransport
  /** Monotonic-enough wall clock; Date.now in production. */
  now?: () => number
  /** Freshness/failure cooldown. */
  refreshIntervalMs?: number
  /** Installed route ids retained in the dispatch superset. */
  installedModelIds?: () => readonly string[]
  /** Optional Phoenix-compatible diagnostic sink. */
  logger?: { warn(value: unknown): void }
}

/**
 * Account-visible Codex catalog with last-good fallback and request coalescing.
 *
 * The visible set is replaced exactly after every valid non-empty refresh. The
 * dispatch set only grows during the process lifetime and is seeded with the
 * installed catalog, preserving already-selected models while keeping them out
 * of the selector after retirement.
 */
export class CodexLiveCatalog {
  private visible: PiAiModelProfile[] | undefined
  private dispatch: PiAiModelProfile[] | undefined
  /** Exact Codex effort metadata, retained even when pi-ai needs a carrier level. */
  private reasoningByModel = new Map<string, LlmModelReasoningInfo>()
  private lastAttemptAt = Number.NEGATIVE_INFINITY
  private lastSuccessAt = Number.NEGATIVE_INFINITY
  private inFlight: Promise<void> | undefined
  /** Last pinned id set requested; a change invalidates the normal freshness window once. */
  private lastPinnedModelKey: string | undefined
  private readonly transport: CodexModelListTransport
  private readonly now: () => number
  private readonly refreshIntervalMs: number
  private readonly installedModelIds: () => readonly string[]
  private readonly logger: { warn(value: unknown): void } | undefined
  /** Monotonic catalog generation used to invalidate provider-profile memoization. */
  revision = 0

  constructor(options: CodexLiveCatalogOptions = {}) {
    this.transport = options.transport ?? codexModelListTransport
    this.now = options.now ?? Date.now
    this.refreshIntervalMs = options.refreshIntervalMs ?? CODEX_MODEL_REFRESH_INTERVAL_MS
    this.installedModelIds = options.installedModelIds
      ?? (() => [...catalogModels(CODEX_PROVIDER).keys()])
    this.logger = options.logger
  }

  private report(message: string, error?: unknown): void {
    this.logger?.warn(`llm-pi-ai: ${message}`)
    if (error !== undefined) this.logger?.warn(error)
  }

  /**
   * Read the latest account-visible ids in provider order.
   *
   * @returns The last valid live id list, or undefined before any valid refresh.
   */
  visibleIds(): readonly string[] | undefined {
    return this.visible?.map(model => model.id)
  }

  /**
   * Exact reasoning capabilities Codex advertised for one model.
   *
   * Retired models keep their last-good metadata beside the dispatch superset,
   * so an already-selected session remains valid after the model leaves the
   * picker. Returned values are detached from the catalog's retained snapshot.
   * @param modelId - The model id value.
   * @returns The resulting value.
   */
  reasoningForModel(modelId: string): LlmModelReasoningInfo | undefined {
    const reasoning = this.reasoningByModel.get(modelId)
    if (reasoning === undefined) return undefined
    return {
      efforts: reasoning.efforts.map(effort => ({ ...effort })),
      ...reasoning.defaultEffort === undefined ? {} : { defaultEffort: reasoning.defaultEffort },
    }
  }

  /**
   * Overlay live Codex metadata without taking ownership away from a pinned
   * model list.
   *
   * Automatic routes receive the full dispatch superset exactly as before.
   * A non-empty configured list remains the visibility/filter authority, but
   * each retained id is enriched from Codex's last-good profile so a model
   * adopted from Settings does not lose capabilities merely because it became
   * pinned. Explicit `reasoningEfforts: false` still wins as the supported
   * opt-out; otherwise Codex's live reasoning declaration is authoritative.
   *
   * @param providers - Raw provider settings before live Codex augmentation.
   * @returns Provider settings enriched with the last-good Codex catalog.
   */
  overlayProviders(
    providers: Readonly<Record<string, PiAiProviderProfile>>,
  ): Readonly<Record<string, PiAiProviderProfile>> {
    const profile = providers[CODEX_PROVIDER]
    if (this.dispatch === undefined || profile === undefined) return providers

    if (codexCatalogIsAutomatic(profile)) {
      return {
        ...providers,
        [CODEX_PROVIDER]: {
          ...profile,
          models: this.dispatch,
        },
      }
    }

    const liveById = new Map(this.dispatch.map(model => [model.id, model]))
    const configured = profile.models ?? []
    const enriched = configured.map((model) => {
      const live = liveById.get(model.id)
      if (live === undefined) return model
      return {
        ...live,
        ...model,
        ...model.reasoningEfforts === false
          ? { reasoningEfforts: false as const }
          : live.reasoningEfforts === undefined
            ? {}
            : { reasoningEfforts: { ...live.reasoningEfforts } },
      }
    })

    return {
      ...providers,
      [CODEX_PROVIDER]: {
        ...profile,
        models: enriched,
      },
    }
  }

  /** Model ids the adapter should advertise for this profile after a refresh. */
  private advertisedIds(profile: PiAiProviderProfile): readonly string[] | undefined {
    return codexCatalogIsAutomatic(profile)
      ? this.visibleIds()
      : profile.models?.map(model => model.id)
  }

  /**
   * Refresh Codex whenever the adapter asks for the configured Codex route.
   * Model-list ownership and metadata freshness are deliberately separate:
   * even a pinned list must keep receiving current capabilities for its ids.
   * Failures and empty replies keep the previous/static catalog. Concurrent
   * callers share one app-server interrogation.
   *
   * @param provider - Provider route requested by the adapter.
   * @param profile - Current raw provider profile for that route.
   * @param force - Retry even inside the failure cooldown when no fresh success exists.
   * @returns Live ids for an automatic route, pinned ids for a configured list,
   * or undefined when unavailable/inapplicable.
   */
  async refresh(
    provider: string,
    profile: PiAiProviderProfile | undefined,
    force = false,
  ): Promise<readonly string[] | undefined> {
    if (provider !== CODEX_PROVIDER || profile === undefined) return undefined

    const automatic = codexCatalogIsAutomatic(profile)
    const pinnedModelKey = automatic
      ? undefined
      : JSON.stringify(profile.models?.map(model => model.id) ?? [])
    const pinnedModelsChanged = pinnedModelKey !== this.lastPinnedModelKey
    this.lastPinnedModelKey = pinnedModelKey

    if (this.inFlight !== undefined) {
      await this.inFlight
      return this.advertisedIds(profile)
    }

    const now = this.now()
    // A model newly adopted from Settings must be enriched immediately even
    // when the previous live catalog is still inside its normal 60s TTL.
    if (!pinnedModelsChanged && this.visible !== undefined && now - this.lastSuccessAt < this.refreshIntervalMs) {
      return this.advertisedIds(profile)
    }
    // After that one pin-change attempt, failures still respect the cooldown
    // so an unavailable Codex process cannot be hammered by UI re-renders.
    if (!force && !pinnedModelsChanged && now - this.lastAttemptAt < this.refreshIntervalMs) {
      return this.advertisedIds(profile)
    }

    this.lastAttemptAt = now
    this.inFlight = this.refreshOnce().finally(() => {
      this.inFlight = undefined
    })
    await this.inFlight
    return this.advertisedIds(profile)
  }

  private async refreshOnce(): Promise<void> {
    try {
      const discovered = await this.transport.list()
      const next = codexModelsToProfiles(discovered)
      if (next.length === 0) {
        this.report('Codex returned an empty live model catalog; keeping the last good/static catalog')
        return
      }

      this.lastSuccessAt = this.now()
      const dispatch = new Map<string, PiAiModelProfile>()
      for (const id of this.installedModelIds()) dispatch.set(id, { id })
      for (const model of this.dispatch ?? []) dispatch.set(model.id, model)
      for (const model of next) dispatch.set(model.id, model)
      const nextDispatch = [...dispatch.values()]

      // Reasoning metadata has its own last-good dispatch lifetime. Models that
      // disappear from the selector retain it; models still present can change
      // capabilities or lose reasoning without requiring a Phoenix upgrade.
      const nextReasoning = new Map(this.reasoningByModel)
      for (const model of discovered) {
        const reasoning = reasoningInfoOf(model)
        if (reasoning === undefined) nextReasoning.delete(model.id)
        else nextReasoning.set(model.id, reasoning)
      }
      const reasoningChanged = !deepEqualJson(
        [...nextReasoning.entries()],
        [...this.reasoningByModel.entries()],
      )

      if (
        deepEqualJson(next, this.visible)
        && deepEqualJson(nextDispatch, this.dispatch)
        && !reasoningChanged
      ) return
      this.visible = next
      this.dispatch = nextDispatch
      this.reasoningByModel = nextReasoning
      this.revision += 1
    } catch (error: unknown) {
      this.report('Live Codex model refresh failed; keeping the last good/static catalog', error)
    }
  }
}
