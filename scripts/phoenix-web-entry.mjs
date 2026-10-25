#!/usr/bin/env node
/**
 * Cross-platform entry for "pnpm phoenix".
 *
 * On Windows, use the exact process supervisor that owns the detached updater,
 * Host lifecycle, crash recovery and exclusive per-port lock. The old direct
 * CLI path created unmanaged Node Hosts that stranded update handoffs.
 * Non-Windows systems retain the historical direct web CLI behavior.
 */
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

export function phoenixWebLaunch(platform = process.platform, forwarded = []) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  return {
    cwd: root,
    args: platform === 'win32'
      ? [join(root, 'scripts', 'phoenix-windows-supervisor.mjs'), ...forwarded]
      : ['--import', 'tsx/esm', join(root, 'apps', 'cli', 'src', 'bin.ts'), 'web', ...forwarded],
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const launch = phoenixWebLaunch(process.platform, process.argv.slice(2))
  const child = spawn(process.execPath, launch.args, {
    cwd: launch.cwd,
    env: process.env,
    stdio: 'inherit',
    windowsHide: false,
  })
  child.once('error', error => {
    console.error('[PHOENIX STARTUP] No se pudo iniciar el Host: ' + (error.stack ?? error.message))
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    process.exitCode = Number.isInteger(code) && code >= 0 ? code : signal ? 1 : 0
  })
  process.on('SIGINT', () => { if (child.exitCode === null) child.kill('SIGINT') })
  process.on('SIGTERM', () => { if (child.exitCode === null) child.kill('SIGTERM') })
}
