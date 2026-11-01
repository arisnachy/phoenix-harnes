/**
 * NVIDIA Build chat catalog, continuously synchronized with its public
 * OpenAI-compatible /v1/models endpoint. Listings are discovery signals, not
 * guarantees of account-level inference permission.
 *
 * Unlike a pinned pi-ai snapshot this catalog admits newly published models
 * and removes missing ids from the selector. Historical ids stay dispatchable
 * for old sessions, and a 410 temporarily quarantines a model for this runtime.
 *
 * @module dsh-llm-pi-ai/nvidia-live-catalog
 */
import { catalogModels } from './catalog.ts'
import type { PiAiModelProfile, PiAiProviderProfile } from './config.ts'

/** NVIDIA Build inference and model-list origin (never a user-supplied URL). */
export const NVIDIA_BUILD_BASE_URL = 'https://integrate.api.nvidia.com/v1'
/** Live catalogue refresh cadence while Phoenix runs. */
export const NVIDIA_MODEL_REFRESH_MS = 5 * 60_000
/** Failed refresh retry cadence. */
export const NVIDIA_MODEL_FAILURE_RETRY_MS = 60_000
/** Do not repeatedly choose a model NVIDIA just rejected with HTTP 410. */
export const NVIDIA_MODEL_QUARANTINE_MS = 60 * 60_000
const NVIDIA_FETCH_TIMEOUT_MS = 8_000
const MAX_LISTING_BYTES = 1_048_576

/**
 * The public /v1/models list contains embeddings and other non-chat services.
 * Those need distinct adapters rather than appearing as chat-completions models.
 * Only reject recognizable non-chat categories; newly named chat models stay
 * eligible without requiring a PHOENIX software update.
 * @param id - Upstream NVIDIA model identifier.
 * @returns True if the ID could be served by a chat adapter.
 */
export function nvidiaChatCandidate(id: string): boolean {
  if (!/^[\w][\w./-]{1,180}$/u.test(id) || !id.includes('/')) return false
  return !/(?:^|[./-])(?:embed|embedding|rerank|retriever|reward|guard|safety|parse|clip|detector|translate|calibration)(?:[./-]|$)/iu.test(id)
}

/**
 * Normalize NVIDIA's public OpenAI-compatible models listing.
 * @param payload - Untrusted public listing payload.
 * @returns Candidate chat-model profiles in deterministic ID order.
 */
export function parseNvidiaChatModels(payload: unknown): PiAiModelProfile[] {
  if (typeof payload !== 'object' || payload === null || !('data' in payload)) return []
  const entries = (payload as { data?: unknown }).data
  if (!Array.isArray(entries)) return []
  const found = new Set<string>()
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null || !('id' in entry)) continue
    const id = (entry as { id?: unknown }).id
    if (typeof id === 'string' && nvidiaChatCandidate(id)) found.add(id)
  }
  return [...found].sort().map(id => ({ id }))
}

/** Network and clock are injectable so tests never contact NVIDIA. */
export interface NvidiaLiveCatalogOptions {
  fetchImpl?: typeof fetch
  now?: () => number
  refreshMs?: number
  failureRetryMs?: number
  logger?: { warn(message: string): void }
}

/** Only account-successful inference proves a model is usable; listing is a hint. */
export class NvidiaLiveCatalog {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly refreshMs: number
  private readonly failureRetryMs: number
  private readonly logger: { warn(message: string): void } | undefined
  private visible: PiAiModelProfile[] | undefined
  private dispatch: PiAiModelProfile[] | undefined
  private blocked = new Map<string, number>()
  private nextRefreshAt = 0
  private inFlight: Promise<void> | undefined
  /** Changes only when dispatch/visible identity changes. */
  revision = 0

  /** @param options - Injectable transport, clock and refresh policy. */
  constructor(options: NvidiaLiveCatalogOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? Date.now
    this.refreshMs = options.refreshMs ?? NVIDIA_MODEL_REFRESH_MS
    this.failureRetryMs = options.failureRetryMs ?? NVIDIA_MODEL_FAILURE_RETRY_MS
    this.logger = options.logger
  }

  private active(id: string): boolean {
    const until = this.blocked.get(id)
    if (until === undefined) return true
    if (until > this.now()) return false
    this.blocked.delete(id)
    return true
  }

  /** @returns Visible candidate IDs; undefined until one valid listing succeeds. */
  visibleIds(): readonly string[] | undefined {
    return this.visible?.filter(model => this.active(model.id)).map(model => model.id)
  }

  /** @returns Last valid visible profiles enriched with installed capacities. */
  visibleModels(): readonly PiAiModelProfile[] | undefined {
    const known = catalogModels('nvidia')
    return this.visible?.filter(model => this.active(model.id)).map(model => {
      const base = known.get(model.id)
      return {
        ...base === undefined ? {} : {
          name: base.name, contextWindow: base.contextWindow, maxTokens: base.maxTokens,
        },
        ...model,
      }
    })
  }

  /**
   * Refresh the public catalog on expiry; concurrent callers share one fetch.
   * @param force - Bypass the normal refresh cooldown.
   * @returns The last valid visible model IDs, if available.
   */
  async refresh(force = false): Promise<readonly string[] | undefined> {
    if (this.inFlight !== undefined) {
      await this.inFlight
      return this.visibleIds()
    }
    if (!force && this.now() < this.nextRefreshAt) return this.visibleIds()
    this.nextRefreshAt = this.now() + this.failureRetryMs
    this.inFlight = this.refreshOnce().finally(() => { this.inFlight = undefined })
    await this.inFlight
    return this.visibleIds()
  }

  private async refreshOnce(): Promise<void> {
    try {
      const response = await this.fetchImpl(`${NVIDIA_BUILD_BASE_URL}/models`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(NVIDIA_FETCH_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const declared = Number(response.headers.get('content-length') ?? Number.NaN)
      if (Number.isFinite(declared) && declared > MAX_LISTING_BYTES) throw new Error('listing too large')
      if (response.body === null) throw new Error('empty NVIDIA listing body')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let body = ''
      let bytes = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          bytes += value.byteLength
          if (bytes > MAX_LISTING_BYTES) throw new Error('listing too large')
          body += decoder.decode(value, { stream: true })
        }
        body += decoder.decode()
      } finally {
        await reader.cancel().catch(() => { /* best-effort reader cleanup */ })
      }
      const next = parseNvidiaChatModels(JSON.parse(body) as unknown)
      // Invalid/empty data is not an authoritative catalog deletion.
      if (next.length === 0) throw new Error('empty or invalid NVIDIA chat catalog')
      const before = this.visible?.map(model => model.id).join('\n')
      const after = next.map(model => model.id).join('\n')
      this.visible = next
      const merged = new Map<string, PiAiModelProfile>()
      for (const id of catalogModels('nvidia').keys()) merged.set(id, { id })
      for (const model of this.dispatch ?? []) merged.set(model.id, model)
      for (const model of next) merged.set(model.id, model)
      const joined = [...merged.values()]
      const dispatchChanged = this.dispatch?.map(model => model.id).join('\n')
        !== joined.map(model => model.id).join('\n')
      this.dispatch = joined
      this.nextRefreshAt = this.now() + this.refreshMs
      if (before !== after || dispatchChanged) this.revision += 1
    } catch (error: unknown) {
      this.nextRefreshAt = this.now() + this.failureRetryMs
      this.logger?.warn(`nvidia: live catalog unavailable, keeping last good snapshot (${error instanceof Error ? error.message : String(error)})`)
    }
  }

  /**
   * A 410 is a hard negative for this process. Exclude the id from the visible
   * list immediately, refresh the catalog once, then offer a safe alternative.
   */
  /** @param id - Model rejected by NVIDIA. @param needsImage - Input requires vision. @returns An eligible replacement or none. */
  async markUnavailable(id: string, needsImage = false): Promise<string | undefined> {
    this.blocked.set(id, this.now() + NVIDIA_MODEL_QUARANTINE_MS)
    this.revision += 1
    await this.refresh(true)
    return this.preferredModel(id, needsImage)
  }

  /**
   * Preserve a user's selected id while listed; otherwise choose a compatible
   * active candidate. Prefer the same model publisher; a different publisher
   * is a last resort. Never route an image to an unverified text-only model.
   * @param id - Model requested by the caller.
   * @param needsImage - Whether input includes an image.
   * @returns Alternative ID or undefined if current model stays usable.
   */
  preferredModel(id: string, needsImage = false): string | undefined {
    const available = this.visibleIds()
    if (available === undefined || available.includes(id)) return undefined
    const publisher = id.split('/')[0]
    const installed = catalogModels('nvidia')
    const eligible = available.filter(candidate => {
      if (candidate === id) return false
      return !needsImage || installed.get(candidate)?.input.includes('image') === true
    })
    const sibling = eligible.find(candidate => candidate.startsWith(`${publisher}/`))
    return sibling ?? eligible[0]
  }

  /**
   * Merge current NVIDIA ids into runtime dispatch without rewriting saved
   * settings. Explicit pinned preferences survive as dispatch entries but are
   * hidden from the picker when absent from the live catalog.
   * @param providers - Persisted user configuration, never mutated.
   * @returns A derived catalog used only by the running adapter.
   */
  overlayProviders(
    providers: Readonly<Record<string, PiAiProviderProfile>>,
  ): Readonly<Record<string, PiAiProviderProfile>> {
    const profile = providers.nvidia
    if (profile === undefined || this.dispatch === undefined) return providers
    // A user-owned NVIDIA NIM server must enumerate its own models; never
    // mix public NVIDIA Build IDs into a private, self-hosted endpoint.
    if (profile.baseURL !== undefined
      && profile.baseURL.replace(/[/]+$/u, '') !== NVIDIA_BUILD_BASE_URL) return providers
    const pinned = profile.models ?? []
    const entries = new Map<string, PiAiModelProfile>()
    for (const model of pinned) entries.set(model.id, model)
    // Keep SDK-shipped models addressable for existing session history.
    if (pinned.length === 0) {
      for (const id of catalogModels('nvidia').keys()) {
        entries.set(id, { id, ...profile.modelOverrides?.[id] })
      }
    }
    for (const model of this.dispatch) {
      if (!entries.has(model.id)) entries.set(model.id, model)
    }
    // A derived list cannot use modelOverrides as well as explicit models;
    // apply each override to the matching entry above instead.
    const overrides = profile.modelOverrides ?? {}
    for (const [id, entry] of entries) {
      if (overrides[id] !== undefined) entries.set(id, { ...entry, ...overrides[id] })
    }
    return {
      ...providers,
      nvidia: {
        ...profile,
        // Unknown fresh IDs disclose no capacity. Use conservative values
        // while preserving the SDK's richer metadata for known models.
        defaultContextWindow: profile.defaultContextWindow ?? 32_768,
        defaultMaxTokens: profile.defaultMaxTokens ?? 4_096,
        models: [...entries.values()],
        modelOverrides: undefined,
      },
    }
  }
}
