/**
 * Start the source-checkout stable-update watcher without making update
 * availability a boot dependency. The worker owns polling and deferred install;
 * this launcher owns only its lifecycle relationship to the current PHOENIX
 * process.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** Process-level policy for independent updater workers. */
export interface PhoenixUpdateWatcherPolicy {
  readonly supervised: boolean
  readonly startStableWatcher: boolean
  readonly startPreparedRestartBridge: boolean
  readonly startUpstreamWatcher: boolean
  readonly startCodexWatcher: boolean
}

/**
 * Resolve update-worker ownership without touching the filesystem or spawning.
 * Supervisor mode transfers only PHOENIX stable activation; ecosystem freshness
 * remains owned by the Host.
 */
export function phoenixUpdateWatcherPolicy(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PhoenixUpdateWatcherPolicy {
  const supervised = env.PHOENIX_UPDATE_SUPERVISED === '1'
  const autoUpdateEnabled = env.PHOENIX_AUTO_UPDATE !== '0'
  const updateMode = (env.PHOENIX_UPDATE_MODE ?? 'auto').trim().toLowerCase()
  const upstreamMode = (env.PHOENIX_UPSTREAM_UPDATE_MODE ?? 'auto').trim().toLowerCase()
  const codexMode = (env.PHOENIX_CODEX_UPDATE_MODE ?? 'auto').trim().toLowerCase()
  return {
    supervised,
    startStableWatcher: !supervised && autoUpdateEnabled && updateMode !== 'off',
    startPreparedRestartBridge: supervised && autoUpdateEnabled && updateMode === 'auto',
    startUpstreamWatcher: upstreamMode !== 'off',
    startCodexWatcher: codexMode !== 'off',
  }
}

/** Start one best-effort watcher for the lifetime of this PHOENIX process. */
export function startPhoenixUpdateWatcher(): void {
  const rootResult = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (rootResult.status !== 0 || typeof rootResult.stdout !== 'string') return
  const root = resolve(rootResult.stdout.trim())
  if (root.length === 0) return

  const policy = phoenixUpdateWatcherPolicy()

  // Ecosystem freshness is independent from the PHOENIX stable channel.
  // These watchers remain Host-owned even when Windows supervision owns
  // PHOENIX stable activation and restart.
  const upstreamWorker = resolve(root, 'scripts', 'phoenix-upstream-update.mjs')
  if (policy.startUpstreamWatcher && existsSync(upstreamWorker)) {
    startWatcher(root, upstreamWorker, 'PHOENIX UPSTREAM UPDATE', ['--watch', '--parent-pid', String(process.pid)])
  }

  const codexWorker = resolve(root, 'scripts', 'phoenix-codex-update.mjs')
  if (policy.startCodexWatcher && existsSync(codexWorker)) {
    startWatcher(root, codexWorker, 'PHOENIX CODEX UPDATE', ['--watch', '--parent-pid', String(process.pid)])
  }

  if (policy.supervised) {
    const bridge = resolve(root, 'scripts', 'phoenix-prepared-restart-bridge.mjs')
    if (policy.startPreparedRestartBridge && existsSync(bridge)) {
      startWatcher(root, bridge, 'PHOENIX UPDATE', ['--parent-pid', String(process.pid)])
    }
    return
  }

  const stableWorker = resolve(root, 'scripts', 'phoenix-auto-update.mjs')
  if (policy.startStableWatcher && existsSync(stableWorker)) {
    startWatcher(root, stableWorker, 'PHOENIX UPDATE', ['--watch', '--parent-pid', String(process.pid)])
  }
}

function startWatcher(root: string, worker: string, label: string, args: string[]): void {
  try {
    const child = spawn(process.execPath, [worker, ...args], {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
    })
    child.once('error', (error) => {
      console.error(`[${label}] watcher could not start: ${error.message}`)
    })
    // Watchers observe this pid and own no authority over shutdown. If the Host
    // exits, no updater helper may keep it alive.
    child.unref()
  } catch (error) {
    console.error(`[${label}] watcher could not start: ${error instanceof Error ? error.message : String(error)}`)
  }
}
