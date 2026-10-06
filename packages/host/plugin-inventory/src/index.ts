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
import { createChatGptWebIntegration, type ChatGptWebIntegration } from './chatgpt-web.ts'
import {
  createNodeLocalModelRuntimeManager,
  getLocalModelCatalog,
  startPhoenixLocalProxy,
  type LocalModelRuntimeManager,
  type LocalModelRuntimeSnapshot,
} from './local-model/index.ts'
import { searchOfficialMcpRegistry } from './mcp-registry.ts'
import { OpenClawConnectorBridge } from './openclaw-connectors.ts'
import {
  BINANCE_AGENT_OS_SERVER_NAME,
  BINANCE_AGENT_OS_URL,
  JEV_API_KEY_REF,
  X_API_MCP_SERVER_NAME,
  X_PHOENIX_API_MCP_SERVER_NAME,
  X_CLIENT_ID_REF,
  X_CLIENT_SECRET_REF,
  X_DOCS_MCP_SERVER_NAME,
  JEV_MCP_SERVER_NAME,
  ManagedMcpController,
  type XMcpIdentity,
} from './mcp-managed.ts'
import type {
  ChatGptWebSnapshot,
  CuratedMcpInstallRequest,
  JevMcpConfigureRequest,
  JevMcpSnapshot,
  ManagedMcpEntryRequest,
  ManagedMcpRemoveReceipt,
  McpConnectorHubSnapshot,
  McpConnectorRuntimeEntry,
  McpRegistryInstallReceipt,
  McpRegistryInstallRequest,
  McpRegistrySearchRequest,
  McpRegistrySearchSnapshot,
  OpenClawConnectorSnapshot,
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
  private readonly chatGptWeb: ChatGptWebIntegration
  private readonly managedMcp: ManagedMcpController
  private readonly openClawConnectors: OpenClawConnectorBridge

  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
    this.localModel = createNodeLocalModelRuntimeManager()
    this.chatGptWeb = createChatGptWebIntegration()
    this.managedMcp = new ManagedMcpController(ctx.loader)
    this.openClawConnectors = new OpenClawConnectorBridge()
    void ctx.effect(async () => {
      try {
        await this.managedMcp.retireJev()
      } catch (error: unknown) {
        ctx.logger.warn('managed Jev retirement did not fully unload the live entry; persistent config is already retired')
        ctx.logger.warn(error)
      }
      return () => undefined
    }, 'managed Jev retirement')
    void ctx.effect(() => {
      let active = true
      void this.managedMcp.ensureCoreMcpPack().then((result) => {
        if (!active) return
        if (result.failed.length > 0) {
          ctx.logger.warn(
            `core MCP pack restored with ${result.failed.length} connector(s) pending recovery: ${result.failed.map(item => item.connectorId).join(', ')}`,
          )
        }
      }, (error: unknown) => {
        if (!active) return
        ctx.logger.warn('core MCP pack restore failed safely; Phoenix remains available and will retry on the next start')
        ctx.logger.warn(error)
      })
      return () => { active = false }
    }, 'core MCP pack restore')
    void ctx.effect(async () => {
      try {
        await this.chatGptWeb.restore()
      } catch (error: unknown) {
        ctx.logger.error('chatgpt-web: persisted bridge could not be restored')
        ctx.logger.error(error)
      }
      return () => undefined
    }, 'chatgpt-web persisted integration')
    // Cordis owns both loopback resources so reload/unload cannot leave port
    // 17842 occupied or a llama-server child detached from the Host lifecycle.
    void ctx.effect(async () => {
      try {
        const server = await startPhoenixLocalProxy(this.localModel)
        return async () => {
          server.closeAllConnections()
          await new Promise<void>((resolve) => {
            server.close((error) => {
              if (error !== undefined) ctx.logger.error(error)
              resolve()
            })
          })
          await (await this.localModel).dispose()
        }
      } catch (error: unknown) {
        ctx.logger.error('phoenix-local: loopback proxy could not start')
        ctx.logger.error(error)
        return async () => { await (await this.localModel).dispose() }
      }
    }, 'phoenix-local loopback proxy')
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

  /**
   * Read Phoenix Local state and installable catalog without exposing machine paths.
   * @returns Current sanitized Phoenix Local state and catalog.
   */
  @Remote('localModelState')
  async localModelState(): Promise<PhoenixLocalModelSnapshot> {
    return publicLocalSnapshot((await this.localModel).snapshot())
  }


  /**
   * Probe reusable OpenClaw connector sessions already present on this machine.
   * No token, credential path, or command output crosses the Host boundary.
   * @returns Secret-free OpenClaw Google/GitHub readiness.
   */
  @Remote('openClawConnectorState')
  openClawConnectorState(): OpenClawConnectorSnapshot {
    return this.openClawConnectors.snapshot()
  }

  /**
   * Search the public Official MCP Registry from the Host. The browser never
   * calls the registry directly, avoiding cross-origin failures and centralizing
   * timeout, cache, and provenance policy.
   * @param request - sanitized registry search query and result bound.
   * @returns normalized public registry search snapshot.
   */
  @Remote('searchMcpRegistry')
  async searchMcpRegistry(request: McpRegistrySearchRequest): Promise<McpRegistrySearchSnapshot> {
    return searchOfficialMcpRegistry(request)
  }


  /**
   * Return the current MCP lifecycle plus PHOENIX-managed remote connectors.
   * The projection excludes credentials, headers, provider errors, and local paths.
   * @returns Secret-free connector hub state for Settings.
   */
  @Remote('mcpConnectorHubState')
  async mcpConnectorHubState(): Promise<McpConnectorHubSnapshot> {
    const service = (this.ctx.get as (name: string) => unknown)('mcpConnectors') as
      | { list(): readonly McpConnectorRuntimeEntry[] }
      | undefined
    return {
      runtime: service === undefined ? [] : service.list().map(entry => ({
        serverName: entry.serverName,
        transport: entry.transport,
        status: entry.status,
        toolNames: [...entry.toolNames],
        ...(entry.reasonCode === undefined ? {} : { reasonCode: entry.reasonCode }),
      })),
      managed: [...await this.managedMcp.snapshot()],
    }
  }

  /**
   * Ask one already-registered MCP runtime to reconnect immediately.
   * The browser supplies only the stable server namespace; no URL, credential,
   * command, header, or provider detail crosses this boundary.
   * @param request - MCP server namespace currently present in the live registry.
   * @returns Whether a live connector accepted the reconnect request.
   */
  @Remote('reconnectMcpConnector')
  reconnectMcpConnector(request: { serverName: string }): { accepted: boolean } {
    const serverName = request.serverName.trim()
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(serverName)) {
      throw new Error('invalid MCP server name')
    }
    const service = (this.ctx.get as (name: string) => unknown)('mcpConnectors') as
      | { reconnect(serverName: string): boolean }
      | undefined
    return { accepted: service?.reconnect(serverName) ?? false }
  }

  /**
   * Install one registry-listed Streamable HTTP MCP after Host-side revalidation.
   * Browser arguments cannot supply a URL, executable, environment, or headers.
   * @param request - Exact registry identity selected from a search result.
   * @returns Idempotent managed connector installation receipt.
   */
  @Remote('installMcpRegistryServer')
  async installMcpRegistryServer(request: McpRegistryInstallRequest): Promise<McpRegistryInstallReceipt> {
    return this.managedMcp.install(request)
  }

  /**
   * Install one Host-curated MCP whose endpoint is pinned in Phoenix code.
   * Browser input selects only a known connector id and can never supply a URL.
   * @param request - Exact curated connector id.
   * @returns Idempotent managed connector installation receipt.
   */
  @Remote('installCuratedMcpConnector')
  async installCuratedMcpConnector(request: CuratedMcpInstallRequest): Promise<McpRegistryInstallReceipt> {
    return this.managedMcp.installCuratedMcp(request.connectorId)
  }

  /**
   * Remove one exact PHOENIX-managed MCP from persistence and the live Loader.
   * The browser supplies only the managed entry id.
   * @param request - Exact PHOENIX-managed entry id to remove.
   * @returns Persistent/live removal result.
   */
  @Remote('removeManagedMcpConnector')
  async removeManagedMcpConnector(request: ManagedMcpEntryRequest): Promise<ManagedMcpRemoveReceipt> {
    return this.managedMcp.remove(request)
  }

  /**
   * Repair one PHOENIX-managed MCP strictly from its persisted trusted source.
   * No browser-provided URL, package, command, or environment is accepted.
   * @param request - Exact PHOENIX-managed entry id to repair.
   * @returns Managed connector installation receipt after trusted re-resolution.
   */
  @Remote('repairManagedMcpConnector')
  async repairManagedMcpConnector(request: ManagedMcpEntryRequest): Promise<McpRegistryInstallReceipt> {
    return this.managedMcp.repair(request)
  }

  /**
   * Read the official Binance Agent OS connector state for in-process policy
   * consumers. This is intentionally not a browser Remote: real activation is
   * mediated by the HARDNESS approval tool rather than a silent Settings call.
   * @returns Secret-free pinned connector lifecycle.
   */
  async binanceAgentOsState(): Promise<{
    configured: boolean
    status?: McpConnectorRuntimeEntry['status']
    reasonCode?: McpConnectorRuntimeEntry['reasonCode']
  }> {
    const managed = await this.managedMcp.snapshot()
    const configured = managed.some(connector =>
      connector.serverName === BINANCE_AGENT_OS_SERVER_NAME || connector.url === BINANCE_AGENT_OS_URL)
    const registry = (this.ctx.get as (name: string) => unknown)('mcpConnectors') as
      | { list(): readonly McpConnectorRuntimeEntry[] }
      | undefined
    const runtime = registry?.list().find(entry => entry.serverName === BINANCE_AGENT_OS_SERVER_NAME)
    return {
      configured,
      ...(runtime === undefined ? {} : {
        status: runtime.status,
        ...(runtime.reasonCode === undefined ? {} : { reasonCode: runtime.reasonCode }),
      }),
    }
  }

  /**
   * Activate the pinned official Binance Agent OS MCP after the model-facing
   * approval boundary has been satisfied. This method never places an order.
   * @returns Idempotent managed MCP receipt.
   */
  async enableBinanceAgentOs(): Promise<McpRegistryInstallReceipt> {
    return this.managedMcp.installBinanceAgentOs()
  }

  /**
   * Remove the managed Binance Agent OS route so PAPER mode cannot accidentally
   * retain real-account tools from an earlier session.
   * @returns Whether a managed Binance Agent OS entry was removed.
   */
  async disableBinanceAgentOs(): Promise<{ disabled: boolean }> {
    return { disabled: await this.managedMcp.removeBinanceAgentOs() }
  }

  /**
   * Read the official X MCP bundle state without exposing OAuth application secrets.
   * @returns Secret-free credential presence plus API/Docs connector lifecycle.
   */
  async xMcpState(): Promise<{
    clientIdConfigured: boolean
    clientSecretConfigured: boolean
    api: {
      configured: boolean
      status?: McpConnectorRuntimeEntry['status']
      reasonCode?: McpConnectorRuntimeEntry['reasonCode']
    }
    phoenixApi: {
      configured: boolean
      status?: McpConnectorRuntimeEntry['status']
      reasonCode?: McpConnectorRuntimeEntry['reasonCode']
    }
    docs: {
      configured: boolean
      status?: McpConnectorRuntimeEntry['status']
      reasonCode?: McpConnectorRuntimeEntry['reasonCode']
    }
  }> {
    const credentials = (this.ctx.get as (name: string) => unknown)('credentials') as
      | { describe(ref: string): Promise<{ configured: boolean }> }
      | undefined
    const [clientIdConfigured, clientSecretConfigured] = credentials === undefined
      ? [false, false]
      : await Promise.all([
        credentials.describe(X_CLIENT_ID_REF).then(info => info.configured),
        credentials.describe(X_CLIENT_SECRET_REF).then(info => info.configured),
      ])
    const managed = await this.managedMcp.snapshot()
    const apiConfigured = managed.some(connector => connector.serverName === X_API_MCP_SERVER_NAME)
    const phoenixApiConfigured = managed.some(connector =>
      connector.serverName === X_PHOENIX_API_MCP_SERVER_NAME)
    const docsConfigured = managed.some(connector => connector.serverName === X_DOCS_MCP_SERVER_NAME)
    const registry = (this.ctx.get as (name: string) => unknown)('mcpConnectors') as
      | { list(): readonly McpConnectorRuntimeEntry[] }
      | undefined
    const apiRuntime = registry?.list().find(entry => entry.serverName === X_API_MCP_SERVER_NAME)
    const phoenixApiRuntime = registry?.list().find(entry =>
      entry.serverName === X_PHOENIX_API_MCP_SERVER_NAME)
    const docsRuntime = registry?.list().find(entry => entry.serverName === X_DOCS_MCP_SERVER_NAME)
    const runtimeState = (configured: boolean, runtime: McpConnectorRuntimeEntry | undefined) => ({
      configured,
      ...(runtime === undefined ? {} : {
        status: runtime.status,
        ...(runtime.reasonCode === undefined ? {} : { reasonCode: runtime.reasonCode }),
      }),
    })
    return {
      clientIdConfigured,
      clientSecretConfigured,
      api: runtimeState(apiConfigured, apiRuntime),
      phoenixApi: runtimeState(phoenixApiConfigured, phoenixApiRuntime),
      docs: runtimeState(docsConfigured, docsRuntime),
    }
  }

  /**
   * Activate the exact official X API xurl bridge and X Docs MCP pair.
   * @param options - X identity selection and optional cached-account username.
   * @returns Idempotent receipts for both pinned connectors.
   */
  async enableXMcp(options: { identity?: XMcpIdentity; username?: string } = {}): Promise<{
    api: McpRegistryInstallReceipt
    docs: McpRegistryInstallReceipt
  }> {
    return this.managedMcp.installXMcp(options)
  }

  /**
   * Remove only the PHOENIX-managed X API and X Docs connector rows.
   * @returns Whether one or more X MCP rows were removed.
   */
  async disableXMcp(): Promise<{ disabled: boolean }> {
    return { disabled: await this.managedMcp.removeXMcp() }
  }

  /**
   * Return Jev setup state without exposing the stored API key.
   * @returns Secret-free configured, credential, and runtime status.
   */
  @Remote('jevMcpState')
  async jevMcpState(): Promise<JevMcpSnapshot> {
    const credentials = (this.ctx.get as (name: string) => unknown)('credentials') as
      | { describe(ref: string): Promise<{ configured: boolean }> }
      | undefined
    const credentialConfigured = credentials === undefined
      ? false
      : (await credentials.describe(JEV_API_KEY_REF)).configured
    const managed = await this.managedMcp.snapshot()
    const configured = managed.some(connector => connector.serverName === JEV_MCP_SERVER_NAME)
    const registry = (this.ctx.get as (name: string) => unknown)('mcpConnectors') as
      | { list(): readonly McpConnectorRuntimeEntry[] }
      | undefined
    const runtime = registry?.list().find(entry => entry.serverName === JEV_MCP_SERVER_NAME)
    return {
      configured,
      credentialConfigured,
      ...(runtime === undefined ? {} : {
        status: runtime.status,
        ...(runtime.reasonCode === undefined ? {} : { reasonCode: runtime.reasonCode }),
      }),
    }
  }

  /**
   * Store the Jev key in PHOENIX credentials and activate the pinned optional MCP.
   * The secret never enters the managed loader overlay.
   * @param _request - Retired Jev setup request retained only for wire compatibility.
   * @returns Installation receipt for the pinned Jev connector.
   */
  @Remote('configureJevMcp')
  async configureJevMcp(_request: JevMcpConfigureRequest): Promise<McpRegistryInstallReceipt> {
    throw new Error('Jev integration is retired because new Jev accounts are unavailable; PHOENIX uses native routing instead')
  }

  /**
   * Install the selected local model and pinned runtime after cryptographic verification.
   * @param request - Local-model installation request.
   * @returns Updated sanitized Phoenix Local state.
   */
  @Remote('installLocalModel')
  async installLocalModel(request: PhoenixLocalModelRequest): Promise<PhoenixLocalModelSnapshot> {
    return publicLocalSnapshot(await (await this.localModel).install(request.modelId))
  }

  /**
   * Start Phoenix Local now, regardless of whether a chat has requested it yet.
   * @returns Updated sanitized Phoenix Local state.
   */
  @Remote('startLocalModel')
  async startLocalModel(): Promise<PhoenixLocalModelSnapshot> {
    return publicLocalSnapshot(await (await this.localModel).start())
  }

  /**
   * Stop local inference while leaving the Phoenix Host itself running.
   * @returns Updated sanitized Phoenix Local state.
   */
  @Remote('stopLocalModel')
  async stopLocalModel(): Promise<PhoenixLocalModelSnapshot> {
    return publicLocalSnapshot(await (await this.localModel).stop())
  }

  /**
   * Remove one managed local model, stopping it first when necessary.
   * @param request - Local-model uninstall request.
   * @returns Updated sanitized Phoenix Local state.
   */
  @Remote('uninstallLocalModel')
  async uninstallLocalModel(request: PhoenixLocalModelRequest): Promise<PhoenixLocalModelSnapshot> {
    return publicLocalSnapshot(await (await this.localModel).uninstall(request.modelId))
  }

  /**
   * Persist Phoenix Local's off/on-demand/always-on policy.
   * @param request - Requested Phoenix Local runtime mode.
   * @returns Updated sanitized Phoenix Local state.
   */
  @Remote('setLocalModelMode')
  async setLocalModelMode(request: PhoenixLocalModeRequest): Promise<PhoenixLocalModelSnapshot> {
    return publicLocalSnapshot(await (await this.localModel).setMode(request.mode))
  }

  /**
   * Choose which installed or installable local model the stable Phoenix route represents.
   * @param request - Requested default local model.
   * @returns Updated sanitized Phoenix Local state.
   */
  @Remote('setDefaultLocalModel')
  async setDefaultLocalModel(request: PhoenixLocalModelRequest): Promise<PhoenixLocalModelSnapshot> {
    return publicLocalSnapshot(await (await this.localModel).setDefaultModel(request.modelId))
  }

  /**
   * Ensure the on-demand runtime is healthy before local inference. This is
   * also exposed to trusted clients as a diagnostic action.
   * @returns Loopback endpoint receipt for the healthy Phoenix Local runtime.
   */
  @Remote('ensureLocalModelRunning')
  async ensureLocalModelRunning(): Promise<PhoenixLocalEndpointReceipt> {
    return { baseUrl: await (await this.localModel).ensureRunning() }
  }

  /**
   * Read the persisted ChatGPT Web switch and current loopback health.
   * @returns Sanitized integration state with no browser credentials.
   */
  @Remote('chatGptWebState')
  async chatGptWebState(): Promise<ChatGptWebSnapshot> {
    return this.chatGptWeb.state()
  }

  /**
   * Start and health-check ChatGPT Web before Settings exposes its route.
   * @returns Ready state or setup/availability guidance.
   */
  @Remote('enableChatGptWeb')
  async enableChatGptWeb(): Promise<ChatGptWebSnapshot> {
    return this.chatGptWeb.enable()
  }

  /**
   * Persist ChatGPT Web OFF and stop only the bridge process Phoenix owns.
   * @returns Off state after cleanup.
   */
  @Remote('disableChatGptWeb')
  async disableChatGptWeb(): Promise<ChatGptWebSnapshot> {
    return this.chatGptWeb.disable()
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
