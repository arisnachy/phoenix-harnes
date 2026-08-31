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
  // phoenix-windows-supervisor.mjs already owns the one authoritative watcher.
  // Starting a second host-bound watcher here creates a shutdown race where the
  // legacy parent-exit activation can compete with the supervised activator.
  if (process.env.PHOENIX_UPDATE_SUPERVISED === '1') return

  const rootResult = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (rootResult.status !== 0 || typeof rootResult.stdout !== 'string') return
  const root = resolve(rootResult.stdout.trim())
  if (root.length === 0) return

  const stableWorker = resolve(root, 'scripts', 'phoenix-auto-update.mjs')
  if ((process.env.PHOENIX_UPDATE_MODE ?? 'auto').trim().toLowerCase() !== 'off' && existsSync(stableWorker)) {
    startWatcher(root, stableWorker, 'PHOENIX UPDATE')
  }

  const upstreamMode = (process.env.PHOENIX_UPSTREAM_UPDATE_MODE ?? 'auto').trim().toLowerCase()
  const upstreamWorker = resolve(root, 'scripts', 'phoenix-upstream-update.mjs')
  if (upstreamMode !== 'off' && existsSync(upstreamWorker)) {
    startWatcher(root, upstreamWorker, 'PHOENIX UPSTREAM UPDATE')
  }
}

function startWatcher(root: string, worker: string, label: string): void {
  try {
    const child = spawn(process.execPath, [worker, '--watch', '--parent-pid', String(process.pid)], {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
    })
    child.once('error', (error) => {
      console.error(`[${label}] watcher could not start: ${error.message}`)
    })
    // The watcher observes this pid and owns no authority over shutdown. If the
    // host decides to exit, an updater child must never keep it alive.
    child.unref()
  } catch (error) {
    console.error(`[${label}] watcher could not start: ${error instanceof Error ? error.message : String(error)}`)
  }
}
