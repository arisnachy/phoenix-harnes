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
