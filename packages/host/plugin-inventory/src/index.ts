/** Read-only projection of PHOENIX runtime and current plugin inventories. */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from 'zod'
import type {
  CodexArsenalInventory,
  CodexPluginInventoryEntry,
  PhoenixRuntimeView,
  PhoenixUpdatePhase,
  PhoenixUpdateView,
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
} from './types.ts'

export type * from './types.ts'

function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginFiberPhase>

const UPDATE_PHASES = new Set<PhoenixUpdatePhase>([
  'idle', 'checking', 'available', 'downloading', 'preparing', 'ready-restart',
  'installing', 'restarting', 'updated', 'rolled-back', 'error',
])

interface CodexArsenalFile {
  schema?: unknown
  sourceRepository?: unknown
  sourceCommit?: unknown
  syncedAt?: unknown
  enabledMcpPlugins?: unknown
  plugins?: unknown
}

interface CodexPluginFile {
  name?: unknown
  version?: unknown
  description?: unknown
  category?: unknown
  surfaces?: unknown
  skillAliases?: unknown
  mcpServers?: unknown
  requiredEnv?: unknown
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function repositoryRoot(): string {
  const manifestPath = fileURLToPath(new URL('../../../../package.json', import.meta.url))
  return dirname(manifestPath)
}

function gitValue(root: string, args: string[]): string | undefined {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return result.status === 0 && typeof result.stdout === 'string' ? result.stdout.trim() : undefined
}

function runtimeVersion(root: string): string {
  const value = readJson(resolve(root, 'package.json'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return '0.0.0'
  return text((value as { version?: unknown }).version, '0.0.0')
}

function updateView(root: string): PhoenixUpdateView {
  const gitDir = gitValue(root, ['rev-parse', '--git-dir'])
  if (gitDir === undefined) return { phase: 'idle' }
  const statePath = resolve(root, gitDir, 'phoenix-update-state.json')
  if (!existsSync(statePath)) return { phase: 'idle' }
  const value = readJson(statePath)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { phase: 'idle' }
  const state = value as Record<string, unknown>
  const rawPhase = text(state.phase, text(state.status, 'idle'))
  const phase: PhoenixUpdatePhase = UPDATE_PHASES.has(rawPhase as PhoenixUpdatePhase)
    ? rawPhase as PhoenixUpdatePhase
    : rawPhase === 'rollback-failed' ? 'error' : 'idle'
  const progress = typeof state.progress === 'number' && Number.isFinite(state.progress)
    ? Math.max(0, Math.min(100, state.progress))
    : undefined
  return {
    phase,
    ...progress === undefined ? {} : { progress },
    ...typeof state.current === 'string' ? { current: state.current } : {},
    ...typeof state.target === 'string' ? { target: state.target } : {},
    ...typeof state.message === 'string' ? { message: state.message } : {},
    ...typeof state.at === 'string' ? { at: state.at } : {},
  }
}

function runtimeView(): PhoenixRuntimeView {
  const root = repositoryRoot()
  return {
    product: 'PHOENIX HARDNESS',
    version: runtimeVersion(root),
    buildSha: gitValue(root, ['rev-parse', 'HEAD']) ?? 'unknown',
    channel: process.env.PHOENIX_UPDATE_CHANNEL ?? 'stable',
    update: updateView(root),
  }
}

function codexInventory(): CodexArsenalInventory | null {
  const path = dshHomePath('codex', 'arsenal.json')
  if (!existsSync(path)) return null
  const value = readJson(path)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const file = value as CodexArsenalFile
  if (file.schema !== 1 || !Array.isArray(file.plugins)) return null
  const enabled = new Set(strings(file.enabledMcpPlugins))
  const plugins: CodexPluginInventoryEntry[] = file.plugins.flatMap((raw) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return []
    const plugin = raw as CodexPluginFile
    const name = text(plugin.name)
    if (name.length === 0) return []
    return [{
      name,
      version: text(plugin.version, 'unknown'),
      description: text(plugin.description),
      category: text(plugin.category, 'other'),
      surfaces: strings(plugin.surfaces),
      skillCount: strings(plugin.skillAliases).length,
      mcpServers: strings(plugin.mcpServers),
      requiredEnv: strings(plugin.requiredEnv),
      mcpEnabled: enabled.has(name),
    }]
  })
  return {
    sourceRepository: text(file.sourceRepository),
    sourceCommit: text(file.sourceCommit),
    syncedAt: text(file.syncedAt),
    plugins,
  }
}

/** Remote-only service exposing the current runtime and plugin state. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader']

  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
  }

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
    return { runtime: runtimeView(), codex: codexInventory(), entries }
  }
}

export default PluginInventoryGateway
