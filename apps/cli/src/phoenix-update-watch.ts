/**
 * Start the source-checkout stable-update watcher without making update
 * availability a boot dependency. The supervisor owns the updater worker and
 * guarantees that an update/rollback transition cannot leave PHOENIX closed.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** Start one best-effort update supervisor for the lifetime of this PHOENIX process. */
export function startPhoenixUpdateWatcher(): void {
  if ((process.env.PHOENIX_UPDATE_MODE ?? 'auto').trim().toLowerCase() === 'off') return

  const rootResult = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (rootResult.status !== 0 || typeof rootResult.stdout !== 'string') return
  const root = resolve(rootResult.stdout.trim())
  if (root.length === 0) return

  const supervisor = resolve(root, 'scripts', 'phoenix-update-supervisor.mjs')
  if (!existsSync(supervisor)) return

  try {
    const child = spawn(process.execPath, [
      supervisor,
      '--parent-pid', String(process.pid),
      '--root', root,
    ], {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
    })
    child.once('error', (error) => {
      console.error(`[PHOENIX UPDATE] supervisor could not start: ${error.message}`)
    })
    // The supervisor watches this pid and may outlive it only long enough to
    // complete an update/rollback and ensure the replacement host is serving.
    child.unref()
  } catch (error) {
    console.error(`[PHOENIX UPDATE] supervisor could not start: ${error instanceof Error ? error.message : String(error)}`)
  }
}
