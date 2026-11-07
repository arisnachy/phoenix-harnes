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

const entryPath = fileURLToPath(import.meta.url)
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
const isEntry = process.platform === 'win32'
  ? invokedPath.toLowerCase() === resolve(entryPath).toLowerCase()
  : invokedPath === entryPath
if (isEntry) {
  const launch = phoenixWebLaunch(process.platform, process.argv.slice(2))
  // Source checkouts launched through "pnpm phoenix" also get the optional
  // companion preparation used by managed Windows installs. Never delay the
  // Phoenix UI or run Gateway onboarding during startup.
  if (process.env.PHOENIX_COMPANION_BOOTSTRAP !== '0') {
    for (const script of ['phoenix-clawhub-bootstrap.mjs', 'phoenix-openclaw-bootstrap.mjs']) {
      try {
        const task = spawn(process.execPath, [
          join(launch.cwd, 'scripts', script), '--ensure', '--quiet',
          ...(script === 'phoenix-clawhub-bootstrap.mjs' ? ['--update'] : []),
        ], {
          cwd: launch.cwd, env: process.env, stdio: 'ignore', windowsHide: true, detached: true,
        })
        task.on('error', () => {})
        task.unref()
      } catch {
        // Companion setup is noncritical. The existing Connections/Skills remain available.
      }
    }
  }
  // 'pnpm phoenix' is a distinct entrypoint from update-phoenix.ps1.
  // Ensure anatomy dependencies on either path without delaying Kira startup.
  if (process.env.PHOENIX_ANATOMY_AUTO_INSTALL !== '0') {
    try {
      const anatomy = spawn(process.execPath, [
        join(launch.cwd,'scripts','phoenix-anatomy-auto.mjs'),'--ensure',
      ],{cwd:launch.cwd,env:process.env,stdio:'ignore',detached:true,
         windowsHide:true,shell:false})
      anatomy.on('error',()=>{})
      anatomy.unref()
    } catch { /* Optional setup: never prevent PHOENIX from opening. */ }
  }
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
