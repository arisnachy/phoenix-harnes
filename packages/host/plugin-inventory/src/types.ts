import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable Loader-tree identity of one configured plugin entry. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Lifecycle state of an entry's root Fiber, or null when it has no live root Fiber. */
export type PluginFiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

/** One non-group Loader entry exposed to trusted clients. */
export interface PluginInventoryEntry {
  readonly entryId: PluginEntryId
  readonly moduleName: string
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
}

/** Update states written by the source-checkout updater for the graphical client. */
export type PhoenixUpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'preparing'
  | 'ready-restart'
  | 'installing'
  | 'restarting'
  | 'updated'
  | 'rolled-back'
  | 'error'

export interface PhoenixUpdateView {
  readonly phase: PhoenixUpdatePhase
  readonly progress?: number
  readonly current?: string
  readonly target?: string
  readonly message?: string
  readonly at?: string
}

/** Identity of the exact PHOENIX runtime serving this browser. */
export interface PhoenixRuntimeView {
  readonly product: 'PHOENIX HARDNESS'
  readonly version: string
  readonly buildSha: string
  readonly channel: string
  readonly update: PhoenixUpdateView
}

/** Safe graphical projection of one synchronized official Codex plugin. */
export interface CodexPluginInventoryEntry {
  readonly name: string
  readonly version: string
  readonly description: string
  readonly category: string
  readonly surfaces: readonly string[]
  readonly skillCount: number
  readonly mcpServers: readonly string[]
  /** Environment variable NAMES only; values are never exposed. */
  readonly requiredEnv: readonly string[]
  readonly mcpEnabled: boolean
}

export interface CodexArsenalInventory {
  readonly sourceRepository: string
  readonly sourceCommit: string
  readonly syncedAt: string
  readonly plugins: readonly CodexPluginInventoryEntry[]
}

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  readonly runtime: PhoenixRuntimeView
  readonly codex: CodexArsenalInventory | null
  readonly entries: readonly PluginInventoryEntry[]
}
