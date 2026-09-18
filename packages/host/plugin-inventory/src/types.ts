import type { Branded } from '@phoenix-ai/dsh-brand'

/** Stable Loader-tree identity of one configured plugin entry. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Lifecycle state of an entry's root Fiber, or null when it has no live root Fiber. */
export type PluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/** One non-group Loader entry exposed to trusted clients. */
export interface PluginInventoryEntry {
  readonly entryId: PluginEntryId
  /** Exact module specifier imported by the Loader entry. */
  readonly moduleName: string
  /** Effective Loader enablement, including disabled ancestor groups. */
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
}

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  readonly entries: readonly PluginInventoryEntry[]
}


/** Supported transport labels projected from Official MCP Registry metadata. */
export type McpRegistryTransport = 'stdio' | 'streamable-http' | 'sse'

/** Sanitized display icon from one registry-listed MCP server. */
export interface McpRegistryIcon {
  readonly src: string
  readonly mimeType?: 'image/png' | 'image/jpeg' | 'image/jpg' | 'image/svg+xml' | 'image/webp'
  readonly sizes?: readonly string[]
}

/** Sanitized package locator from one registry-listed MCP server. */
export interface McpRegistryPackage {
  readonly registryType: string
  readonly identifier: string
  readonly transport: McpRegistryTransport
  readonly version?: string
  readonly runtimeHint?: string
}

/**
 * Registry discovery candidate. `trust` intentionally says only that the
 * server is listed in the Official MCP Registry; it does not imply the named
 * product vendor authored the server.
 */
export interface McpRegistryCandidate {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly version: string
  readonly status: 'active' | 'deprecated' | 'deleted' | 'unknown'
  readonly trust: 'registry-listed'
  readonly icons: readonly McpRegistryIcon[]
  readonly transports: readonly McpRegistryTransport[]
  readonly packages: readonly McpRegistryPackage[]
  readonly repositoryUrl?: string
  readonly websiteUrl?: string
  readonly remoteUrl?: string
}

/** Browser/model request for an Official MCP Registry name search. */
export interface McpRegistrySearchRequest {
  readonly query: string
  readonly limit?: number
}

/** Secret-free result from the Host-owned registry proxy. */
export interface McpRegistrySearchSnapshot {
  readonly source: 'official-mcp-registry'
  readonly query: string
  readonly fetchedAt: string
  readonly stale: boolean
  readonly candidates: readonly McpRegistryCandidate[]
}


/** Secret-free runtime lifecycle for one configured MCP server. */
export interface McpConnectorRuntimeEntry {
  readonly serverName: string
  readonly transport: 'stdio' | 'streamable-http'
  readonly status: 'starting' | 'ready' | 'disconnected' | 'failed' | 'auth-required'
  readonly toolNames: readonly string[]
  readonly reasonCode?: 'connection-failed' | 'connection-lost' | 'authorization-required' | 'retry-exhausted'
}

/** One PHOENIX-managed remote MCP persisted in the managed overlay. */
export interface ManagedMcpConnector {
  readonly entryId: string
  readonly serverName: string
  readonly url: string
}

/** Combined MCP state used by Settings without exposing credentials or headers. */
export interface McpConnectorHubSnapshot {
  readonly runtime: readonly McpConnectorRuntimeEntry[]
  readonly managed: readonly ManagedMcpConnector[]
}

/** Explicit install request for a registry-listed MCP candidate. */
export interface McpRegistryInstallRequest {
  readonly name: string
  readonly version?: string
}

/** Result of installing a safe registry-listed Streamable HTTP MCP. */
export interface McpRegistryInstallReceipt {
  readonly status: 'installed' | 'already-installed'
  readonly connector: ManagedMcpConnector
}

/** Stable updater lifecycle states projected to trusted Web clients. */
export type PhoenixUpdateStatus =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'preparing'
  | 'ready'
  | 'restarting'
  | 'applying'
  | 'rolling-back'
  | 'updated'
  | 'rolled-back'
  | 'paused'
  | 'error'
  | 'rollback-failed'
  | 'off'

/** Sanitized updater state read from the repository-owned Git directory. */
export interface PhoenixUpdateSnapshot {
  readonly status: PhoenixUpdateStatus
  readonly phase?: string
  readonly current?: string
  readonly target?: string
  readonly previous?: string
  readonly failedTarget?: string
  readonly channelPublishedAt?: string
  readonly detail?: string
  readonly at?: string
}

/** Result of asking the live Host to restart into a prepared update. */
export interface PhoenixUpdateRestartReceipt {
  readonly accepted: boolean
  readonly status: PhoenixUpdateStatus
}

/** Result of waking the detached updater for an immediate channel check. */
export interface PhoenixUpdateRefreshReceipt {
  readonly accepted: boolean
}

/** User-selectable Phoenix Local runtime policy. */
export type PhoenixLocalModelMode = 'off' | 'on-demand' | 'always-on'

/** Public Phoenix Local lifecycle state. */
export type PhoenixLocalModelPhase =
  | 'not-installed'
  | 'installing'
  | 'ready'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'

/** One installable local-model choice safe to show in Settings. */
export interface PhoenixLocalModelCatalogEntry {
  readonly id: string
  readonly displayName: string
  readonly sizeBytes: number
  readonly estimatedRamBytes: number
  readonly contextWindow: number
  readonly maxTokens: number
  readonly recommended: boolean
}

/** Sanitized download progress; filesystem paths never cross the Host boundary. */
export interface PhoenixLocalModelProgress {
  readonly receivedBytes: number
  readonly totalBytes?: number
}

/** Sanitized local runtime error suitable for Settings and chat surfaces. */
export interface PhoenixLocalModelError {
  readonly code: string
  readonly message: string
}

/** Complete trusted-client snapshot of Phoenix Local. */
export interface PhoenixLocalModelSnapshot {
  readonly mode: PhoenixLocalModelMode
  readonly selectedModelId: string
  readonly installedModelIds: readonly string[]
  readonly phase: PhoenixLocalModelPhase
  readonly progress?: PhoenixLocalModelProgress
  readonly error?: PhoenixLocalModelError
  readonly catalog: readonly PhoenixLocalModelCatalogEntry[]
}

/** Model-address request used by install/uninstall/default actions. */
export interface PhoenixLocalModelRequest {
  readonly modelId: string
}

/** Runtime-mode request used by Settings. */
export interface PhoenixLocalModeRequest {
  readonly mode: PhoenixLocalModelMode
}

/** Loopback endpoint receipt used internally before local inference. */
export interface PhoenixLocalEndpointReceipt {
  readonly baseUrl: string
}

/** User-facing lifecycle phases for the optional local ChatGPT Web bridge. */
export type ChatGptWebPhase = 'off' | 'needs-setup' | 'starting' | 'ready' | 'unavailable'

/** Sanitized ChatGPT Web state exposed to trusted Settings clients. */
export interface ChatGptWebSnapshot {
  readonly enabled: boolean
  readonly phase: ChatGptWebPhase
  readonly baseUrl: string
  readonly detail: string
}
