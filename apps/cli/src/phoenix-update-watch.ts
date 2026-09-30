/**
 * Start the source-checkout stable-update watcher without making update
 * availability a boot dependency. The worker owns polling and deferred install;
 * this launcher owns only its lifecycle relationship to the current PHOENIX
 * process.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

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

  // Ecosystem freshness is independent from the PHOENIX stable channel.
  // These watchers are best-effort children of the live Host even when the
  // Windows supervisor owns PHOENIX activation/restarts.
  const upstreamMode = (process.env.PHOENIX_UPSTREAM_UPDATE_MODE ?? 'auto').trim().toLowerCase()
  const upstreamWorker = resolve(root, 'scripts', 'phoenix-upstream-update.mjs')
  if (upstreamMode !== 'off' && existsSync(upstreamWorker)) {
    startWatcher(root, upstreamWorker, 'PHOENIX UPSTREAM UPDATE', ['--watch', '--parent-pid', String(process.pid)])
  }

  const codexMode = (process.env.PHOENIX_CODEX_UPDATE_MODE ?? 'auto').trim().toLowerCase()
  const codexWorker = resolve(root, 'scripts', 'phoenix-codex-update.mjs')
  if (codexMode !== 'off' && existsSync(codexWorker)) {
    startWatcher(root, codexWorker, 'PHOENIX CODEX UPDATE', ['--watch', '--parent-pid', String(process.pid)])
  }

  const updateMode = (process.env.PHOENIX_UPDATE_MODE ?? 'auto').trim().toLowerCase()

  // The external Windows supervisor owns only the authoritative PHOENIX stable
  // watcher. Keep ecosystem watchers above alive; return here only after
  // installing the tiny prepared-candidate restart bridge.
  if (process.env.PHOENIX_UPDATE_SUPERVISED === '1') {
    const bridge = resolve(root, 'scripts', 'phoenix-prepared-restart-bridge.mjs')
    if (process.env.PHOENIX_AUTO_UPDATE !== '0' && updateMode === 'auto' && existsSync(bridge)) {
      startWatcher(root, bridge, 'PHOENIX UPDATE', ['--parent-pid', String(process.pid)])
    }
    return
  }

  const stableWorker = resolve(root, 'scripts', 'phoenix-auto-update.mjs')
  if (process.env.PHOENIX_AUTO_UPDATE !== '0' && updateMode !== 'off' && existsSync(stableWorker)) {
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
