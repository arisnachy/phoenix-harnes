/** Read-only Loader inventory plus trusted PHOENIX update and local-model controls. */

import type { Context, FiberState } from '@phoenix-ai/cordis'
import type {} from '@phoenix-ai/cordis-plugin-loader'
import { TypertRemoteService, Remote } from '@phoenix-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import {
  readPhoenixUpdateSnapshot,
  requestPhoenixUpdateRefresh,
  requestPhoenixUpdateRestart,
} from './update-state.ts'
import {
  createNodeLocalModelRuntimeManager,
  getLocalModelCatalog,
  startPhoenixLocalProxy,
  type LocalModelRuntimeManager,
  type LocalModelRuntimeSnapshot,
} from './local-model/index.ts'
import type {
  PhoenixLocalEndpointReceipt,
  PhoenixLocalModeRequest,
  PhoenixLocalModelRequest,
  PhoenixLocalModelSnapshot,
  PhoenixUpdateRestartReceipt,
  PhoenixUpdateRefreshReceipt,
  PhoenixUpdateSnapshot,
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
} from './types.ts'

export type * from './types.ts'

/** Brand an existing Loader-tree entry id at the owning boundary. */
function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Complete public projection of Cordis Fiber states. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginFiberPhase>

/** Strip process/filesystem-only details before local runtime state crosses the Host boundary. */
function publicLocalSnapshot(snapshot: LocalModelRuntimeSnapshot): PhoenixLocalModelSnapshot {
  return {
    mode: snapshot.mode,
    selectedModelId: snapshot.selectedModelId,
    installedModelIds: [...snapshot.installedModelIds],
    phase: snapshot.phase,
    ...snapshot.progress === undefined ? {} : { progress: { ...snapshot.progress } },
    ...snapshot.error === undefined ? {} : { error: { ...snapshot.error } },
    catalog: getLocalModelCatalog().map(model => ({
      id: model.id,
      displayName: model.displayName,
      sizeBytes: model.sizeBytes,
      estimatedRamBytes: model.estimatedRamBytes,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      recommended: model.recommended,
    })),
  }
}

/** Remote service exposing trusted Host diagnostics, updater controls, and Phoenix Local lifecycle. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader']

  private readonly localModel: Promise<LocalModelRuntimeManager>

  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
    this.localModel = createNodeLocalModelRuntimeManager()
    // This proxy is intentionally tiny: it owns no model weights. A request to
    // the normal `phoenix-local` LLM route wakes llama-server only when needed.
    void startPhoenixLocalProxy(this.localModel).catch((error: unknown) => {
      ctx.logger.error('phoenix-local: loopback proxy could not start')
      ctx.logger.error(error)
    })
  }

  /**
   * Read the Loader directly on every call. Cordis's internal plugin/status
   * events already maintain Entry.fiber and Fiber.state, so a second cache
   * would only add another lifecycle truth to keep synchronized.
   * @returns Current non-group Loader entries in Loader order.
   */
  @Remote('list')
  list(): PluginInventorySnapshot {
    const entries: PluginInventoryEntry[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      entries.push({
        entryId: pluginEntryId(entry.id),
        moduleName: entry.options.name,
        enabled: !entry.disabled,
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
      })
    }
    return { entries }
  }

  /** Read Phoenix Local state and installable catalog without exposing machine paths. */
  @Remote('localModelState')
  async localModelState(): Promise<PhoenixLocalModelSnapshot> {
    return publicLocalSnapshot((await this.localModel).snapshot())
  }

  /** Install the selected local model and pinned runtime after cryptographic verification. */
  @Remote('installLocalModel')
  async installLocalModel(request: PhoenixLocalModelRequest): Promise<PhoenixLocalModelSnapshot> {
    return publicLocalSnapshot(await (await this.localModel).install(request.modelId))
  }

  /** Start Phoenix Local now, regardless of whether a chat has requested it yet. */
  @Remote('startLocalModel')
  async startLocalModel(): Promise<PhoenixLocalModelSnapshot> {
    return publicLocalSnapshot(await (await this.localModel).start())
  }

  /** Stop local inference while leaving the Phoenix Host itself running. */
  @Remote('stopLocalModel')
  async stopLocalModel(): Promise<PhoenixLocalModelSnapshot> {
    return publicLocalSnapshot(await (await this.localModel).stop())
  }

  /** Remove one managed local model, stopping it first when necessary. */
  @Remote('uninstallLocalModel')
  async uninstallLocalModel(request: PhoenixLocalModelRequest): Promise<PhoenixLocalModelSnapshot> {
    return publicLocalSnapshot(await (await this.localModel).uninstall(request.modelId))
  }

  /** Persist Phoenix Local's off/on-demand/always-on policy. */
  @Remote('setLocalModelMode')
  async setLocalModelMode(request: PhoenixLocalModeRequest): Promise<PhoenixLocalModelSnapshot> {
    return publicLocalSnapshot(await (await this.localModel).setMode(request.mode))
  }

  /** Choose which installed or installable local model the stable Phoenix route represents. */
  @Remote('setDefaultLocalModel')
  async setDefaultLocalModel(request: PhoenixLocalModelRequest): Promise<PhoenixLocalModelSnapshot> {
    return publicLocalSnapshot(await (await this.localModel).setDefaultModel(request.modelId))
  }

  /**
   * Ensure the on-demand runtime is healthy before local inference. This is
   * also exposed to trusted clients as a diagnostic action.
   */
  @Remote('ensureLocalModelRunning')
  async ensureLocalModelRunning(): Promise<PhoenixLocalEndpointReceipt> {
    return { baseUrl: await (await this.localModel).ensureRunning() }
  }

  /**
   * Read the stable updater's sanitized durable state.
   * @returns Current update lifecycle snapshot; `idle` when no watcher state exists.
   */
  @Remote('updateState')
  updateState(): PhoenixUpdateSnapshot {
    return readPhoenixUpdateSnapshot()
  }

  /**
   * Request activation of an already prepared stable release and terminate this
   * Host only after the request has been durably written. The detached watcher
   * owns activation, rollback and relaunch after this process exits.
   * @returns Whether a prepared update accepted the restart request.
   */
  @Remote('restartForUpdate')
  restartForUpdate(): PhoenixUpdateRestartReceipt {
    const receipt = requestPhoenixUpdateRestart()
    if (receipt.accepted) {
      const timer = setTimeout(() => { process.exit(0) }, 250)
      timer.unref()
    }
    return receipt
  }

  /**
   * Wake the detached updater for a real stable-channel check.
   * @returns Whether the request was durably queued for the watcher.
   */
  @Remote('refreshForUpdate')
  refreshForUpdate(): PhoenixUpdateRefreshReceipt {
    return requestPhoenixUpdateRefresh()
  }
}

export default PluginInventoryGateway
