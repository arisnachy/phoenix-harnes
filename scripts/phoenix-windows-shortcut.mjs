#!/usr/bin/env node
/**
 * Keep the Windows desktop entry for PHOENIX pointed at the durable checkout.
 *
 * Update staging worktrees intentionally do not create shortcuts: their .git
 * entry is a file and they are disposable. The primary checkout and the
 * external Windows supervisor are the only owners allowed to repair the link.
 */

import { spawnSync as nodeSpawnSync } from 'node:child_process'
import { existsSync as nodeExistsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

/** Resolve the durable files used by the Windows desktop shortcut. */
export function phoenixDesktopShortcutSpec(root, env = process.env) {
  const resolvedRoot = resolve(root)
  const systemRoot = env.SystemRoot ?? env.WINDIR
  return {
    root: resolvedRoot,
    setupScript: join(resolvedRoot, 'scripts', 'phoenix-desktop-shortcut.ps1'),
    launchScript: join(resolvedRoot, 'scripts', 'phoenix-desktop-launch.ps1'),
    iconSource: join(resolvedRoot, 'apps', 'web', 'public', 'favicon.png'),
    powershell: systemRoot === undefined || systemRoot.trim().length === 0
      ? 'powershell.exe'
      : join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  }
}

/**
 * Create or repair the PHOENIX desktop shortcut.
 *
 * The dependency hooks are intentionally injectable so the contract can be
 * tested on non-Windows CI without invoking PowerShell.
 */
export function ensurePhoenixDesktopShortcut(root, options = {}) {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32') return { status: 'skipped-non-windows' }

  const env = options.env ?? process.env
  const existsSync = options.existsSync ?? nodeExistsSync
  const spawnSync = options.spawnSync ?? nodeSpawnSync
  const spec = phoenixDesktopShortcutSpec(root, env)

  if (!existsSync(spec.setupScript)) {
    throw new Error(`desktop shortcut setup script is missing: ${spec.setupScript}`)
  }
  if (!existsSync(spec.launchScript)) {
    throw new Error(`desktop launcher script is missing: ${spec.launchScript}`)
  }

  const result = spawnSync(spec.powershell, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    spec.setupScript,
    '-Root',
    spec.root,
  ], {
    cwd: spec.root,
    env,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.error !== undefined) throw result.error
  if ((result.status ?? 1) !== 0) {
    const detail = typeof result.stderr === 'string' ? result.stderr.trim() : ''
    throw new Error(`desktop shortcut setup exited with ${String(result.status)}${detail.length > 0 ? `: ${detail}` : ''}`)
  }

  const shortcut = typeof result.stdout === 'string' ? result.stdout.trim() : ''
  return { status: 'ready', shortcut: shortcut.length > 0 ? shortcut : undefined }
}

function primaryCheckoutForInstall(root) {
  const gitEntry = join(root, '.git')
  try {
    return statSync(gitEntry).isDirectory()
  } catch {
    return false
  }
}

async function main() {
  if (!process.argv.includes('--install')) return
  if (process.platform !== 'win32') return

  const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
  // Candidate updates are linked Git worktrees (.git is a file). Never allow a
  // disposable stage such as phoenix-stage-* to become the user's desktop target.
  if (!primaryCheckoutForInstall(root)) return

  try {
    const result = ensurePhoenixDesktopShortcut(root)
    if (result.status === 'ready' && result.shortcut !== undefined) {
      console.error(`[PHOENIX] desktop shortcut ready: ${result.shortcut}`)
    }
  } catch (error) {
    // A desktop integration failure must never make dependency installation fail.
    console.error(`[PHOENIX] warning: desktop shortcut could not be prepared: ${error instanceof Error ? error.message : String(error)}`)
  }
}

await main()
