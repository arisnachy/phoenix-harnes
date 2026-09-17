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
