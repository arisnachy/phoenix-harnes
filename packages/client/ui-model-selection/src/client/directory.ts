/**
 * Per-session model directory: the ONE state both selection entries share.
 * The /model popup and the composer-seat selector load through the same
 * controller and submit through the same selectModel call, so the host stays
 * the single fact source and the store is one shared echo — a switch made in
 * either entry is what the other shows next.
 */
import type {
  IApiClient, ModelCatalogFailure, ModelProviderGroup, ModelSelection, SessionId, SessionModels,
} from '@phoenix-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@phoenix-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@phoenix-ai/dsh-client-runtime/client'
import {
  assertPhoenixLocalSelectable,
  projectPhoenixLocalAvailability,
  type PhoenixLocalInstallState,
} from './phoenix-local-visibility.ts'

/** Directory snapshot both entries render from. */
export interface ModelDirectoryState {
  /** Model selection the host reports for the next assembled step; null before the first load. */
  current: ModelSelection | null
  /**
   * Whether an adapter serves the current selection's provider, as the host reports
   * it — null before the first load, which is NOT the same as blocked. Read
   * this rather than "current matches no group": catalog membership is
   * advisory, so a route serving a model it stopped advertising is missing
   * from the groups yet perfectly usable.
   */
  routable: boolean | null
  /** Successfully loaded provider groups (last good load). */
  groups: readonly ModelProviderGroup[]
  /** Provider-local failures from the last load; usable groups stay usable. */
  failures: readonly ModelCatalogFailure[]
  /** Lifecycle of the in-flight operation. */
  status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error'
  /** Whole-request or selection failure text; null when none. */
  error: string | null
}

/** One session's shared directory controller; disposed with the session scope. */
export class ModelDirectory {
  /** The shared snapshot both entries render from (uSES-safe store). */
  readonly store: SnapshotStore<ModelDirectoryState> = createSnapshotStore<ModelDirectoryState>({
    current: null, routable: null, groups: [], failures: [], status: 'idle', error: null,
  })

  /** Latest operation wins; an older response never overwrites a newer one. */
  private generation = 0
  private disposed = false
  /** Last complete projected directory; menu opens can reuse it without a Host round-trip. */
  private cached: SessionModels | undefined
  private cachedAt = Number.NEGATIVE_INFINITY
  /** Coalesce mount/open/invalidation bursts into one in-flight directory request. */
  private inFlight: Promise<SessionModels> | undefined

  /**
   * @param sessions - the session wire face (captured from the plugin's root connection).
   * @param sessionId - the owning session.
   * @param available - whether this session may use Agent-bound model RPCs.
   * @param readLocalModelState - optional Host-owned install-state reader used to gate Phoenix Local.
   */
  constructor(
    private readonly sessions: Pick<IApiClient['sessions'], 'models' | 'selectModel'>,
    private readonly sessionId: SessionId,
    private readonly available: () => boolean,
    private readonly readLocalModelState?: () => Promise<PhoenixLocalInstallState | undefined>,
  ) {}

  /**
   * Refresh the advisory directory. Ordinary menu opens reuse a short-lived
   * last-good value; real topology/settings invalidations pass force=true.
   * Host catalog and Phoenix Local state are read in parallel, and concurrent
   * callers share one request.
   * @param options - force bypasses the short freshness window.
   * @returns the projected directory value.
   */
  async load(options: { force?: boolean } = {}): Promise<SessionModels> {
    this.assertAvailable()
    const now = Date.now()
    if (options.force !== true && this.cached !== undefined && now - this.cachedAt < 30_000) {
      return structuredClone(this.cached)
    }
    if (this.inFlight !== undefined) return this.inFlight

    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    const operation = (async (): Promise<SessionModels> => {
      const [{ result }, localState] = await Promise.all([
        this.sessions.models({ sessionId: this.sessionId }),
        this.safeLocalModelState(),
      ])
      if (!result.ok) {
        if (!this.disposed && generation === this.generation) {
          this.store.update((s) => { s.status = 'error'; s.error = `${result.error.code}: ${result.error.message}` })
        }
        throw new Error(`session.models failed: ${result.error.code}: ${result.error.message}`)
      }

      const projected: SessionModels = {
        ...result.value,
        ...projectPhoenixLocalAvailability(result.value, localState),
      }
      if (this.disposed || generation !== this.generation) return projected

      this.cached = structuredClone(projected)
      this.cachedAt = Date.now()
      const { current, routable, groups, failures } = projected
      this.store.update((s) => {
        s.current = current
        s.routable = routable
        s.groups = groups
        s.failures = failures
        s.status = 'ready'
        s.error = null
      })
      return projected
    })()
    this.inFlight = operation
    try {
      return await operation
    } finally {
      if (this.inFlight === operation) this.inFlight = undefined
    }
  }

  /**
   * Select the complete provider/model/reasoning selection (both entries submit through here). Success
   * updates the shared current; failure surfaces on the store and throws so
   * each entry's own retry surface engages.
   * @param selection - provider, provider-owned model id, and optional adapter-owned effort.
 */
  async select(selection: ModelSelection): Promise<void> {
    this.assertAvailable()
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'selecting'; s.error = null })

    const localState = await this.safeLocalModelState()
    if (this.disposed || generation !== this.generation) return
    try {
      assertPhoenixLocalSelectable(selection, localState)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.store.update((s) => { s.status = 'error'; s.error = message })
      throw error
    }

    const { result } = await this.sessions.selectModel({
      sessionId: this.sessionId,
      provider: selection.provider,
      model: selection.model,
      ...selection.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: selection.reasoningEffort },
    })
    if (this.disposed || generation !== this.generation) {
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      return
    }
    if (!result.ok) {
      this.store.update((s) => { s.status = 'error'; s.error = `${result.error.code}: ${result.error.message}` })
      throw new Error(`session.selectModel failed: ${result.error.code}: ${result.error.message}`)
    }
    // The Host validated the route before accepting it, and Phoenix Local has
    // additionally passed the install-state gate immediately before submission.
    this.store.update((s) => {
      s.current = result.value.selected
      s.routable = true
      s.status = 'ready'
      s.error = null
    })
    if (this.cached !== undefined) {
      this.cached = { ...this.cached, current: { ...result.value.selected }, routable: true }
      this.cachedAt = Date.now()
    }
  }

  /**
   * Drop the previous Host generation's projection and repull it. Clearing
   * first prevents an unconsumed process-local selection from being displayed
   * while the restarted Host has restored the last logged model selection.
   */
  resetConnected(): void {
    if (this.disposed) return
    ++this.generation
    this.cached = undefined
    this.cachedAt = Number.NEGATIVE_INFINITY
    this.store.update((s) => {
      s.current = null
      s.routable = null
      s.groups = []
      s.failures = []
      s.status = 'idle'
      s.error = null
    })
    if (!this.available()) return
    void this.load({ force: true }).catch(() => { /* the next menu open remains the explicit retry surface */ })
  }

  /** Scope teardown: late settlements lose write access to the store. */
  dispose(): void {
    this.disposed = true
  }

  /** Read local state without letting an optional Host-Remote failure break cloud model selection. */
  private async safeLocalModelState(): Promise<PhoenixLocalInstallState | undefined> {
    if (this.readLocalModelState === undefined) return undefined
    try {
      return await this.readLocalModelState()
    } catch {
      // Phoenix Local is fail-closed; unrelated cloud providers remain usable.
      return undefined
    }
  }

  private assertAvailable(): void {
    if (!this.available()) {
      throw new Error('model selection is unavailable for addressed subagent sessions')
    }
  }
}
