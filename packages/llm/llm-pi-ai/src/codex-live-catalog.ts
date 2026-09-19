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
 */
export function codexCatalogIsAutomatic(profile: PiAiProviderProfile | undefined): profile is PiAiProviderProfile {
  return profile !== undefined && (profile.models === undefined || profile.models.length === 0)
}

/**
 * Translate Codex account metadata into the profile vocabulary pi-ai can
 * materialize today. Unknown future reasoning levels are ignored rather than
 * crashing the whole selector; the model itself remains selectable.
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

export interface CodexLiveCatalogOptions {
  /** Injectable app-server seam for deterministic tests. */
  transport?: CodexModelListTransport
  /** Monotonic-enough wall clock; Date.now in production. */
  now?: () => number
  /** Freshness/failure cooldown. */
  refreshIntervalMs?: number
  /** Installed route ids retained in the dispatch superset. */
  installedModelIds?: () => readonly string[]
  /** Non-fatal diagnostic sink. */
  warn?: (message: string, error?: unknown) => void
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
  private lastAttemptAt = Number.NEGATIVE_INFINITY
  private lastSuccessAt = Number.NEGATIVE_INFINITY
  private inFlight: Promise<void> | undefined
  private readonly transport: CodexModelListTransport
  private readonly now: () => number
  private readonly refreshIntervalMs: number
  private readonly installedModelIds: () => readonly string[]
  private readonly warn: ((message: string, error?: unknown) => void) | undefined
  revision = 0

  constructor(options: CodexLiveCatalogOptions = {}) {
    this.transport = options.transport ?? codexModelListTransport
    this.now = options.now ?? Date.now
    this.refreshIntervalMs = options.refreshIntervalMs ?? CODEX_MODEL_REFRESH_INTERVAL_MS
    this.installedModelIds = options.installedModelIds
      ?? (() => [...catalogModels(CODEX_PROVIDER).keys()])
    this.warn = options.warn
  }

  /** Latest account-visible ids in provider order, or no live answer yet. */
  visibleIds(): readonly string[] | undefined {
    return this.visible?.map(model => model.id)
  }

  /**
   * Overlay the dispatch superset only when the route is automatic. The input
   * object is returned by identity when no overlay applies.
   */
  overlayProviders(
    providers: Readonly<Record<string, PiAiProviderProfile>>,
  ): Readonly<Record<string, PiAiProviderProfile>> {
    const profile = providers[CODEX_PROVIDER]
    if (this.dispatch === undefined || !codexCatalogIsAutomatic(profile)) return providers
    return {
      ...providers,
      [CODEX_PROVIDER]: {
        ...profile,
        models: this.dispatch,
      },
    }
  }

  /**
   * Refresh Codex when the adapter asks for this route. Failures and empty
   * replies keep the previous/static catalog. Concurrent callers share one
   * app-server interrogation.
   */
  async refresh(
    provider: string,
    profile: PiAiProviderProfile | undefined,
    force = false,
  ): Promise<readonly string[] | undefined> {
    if (provider !== CODEX_PROVIDER || !codexCatalogIsAutomatic(profile)) return undefined

    if (this.inFlight !== undefined) {
      await this.inFlight
      return this.visibleIds()
    }

    const now = this.now()
    if (this.visible !== undefined && now - this.lastSuccessAt < this.refreshIntervalMs) {
      return this.visibleIds()
    }
    if (!force && now - this.lastAttemptAt < this.refreshIntervalMs) {
      return this.visibleIds()
    }

    this.lastAttemptAt = now
    this.inFlight = this.refreshOnce().finally(() => {
      this.inFlight = undefined
    })
    await this.inFlight
    return this.visibleIds()
  }

  private async refreshOnce(): Promise<void> {
    try {
      const next = codexModelsToProfiles(await this.transport.list())
      if (next.length === 0) {
        this.warn?.('Codex returned an empty live model catalog; keeping the last good/static catalog')
        return
      }

      this.lastSuccessAt = this.now()
      const dispatch = new Map<string, PiAiModelProfile>()
      for (const id of this.installedModelIds()) dispatch.set(id, { id })
      for (const model of this.dispatch ?? []) dispatch.set(model.id, model)
      for (const model of next) dispatch.set(model.id, model)
      const nextDispatch = [...dispatch.values()]

      if (deepEqualJson(next, this.visible) && deepEqualJson(nextDispatch, this.dispatch)) return
      this.visible = next
      this.dispatch = nextDispatch
      this.revision += 1
    } catch (error: unknown) {
      this.warn?.('Live Codex model refresh failed; keeping the last good/static catalog', error)
    }
  }
}
