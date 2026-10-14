#!/usr/bin/env node
/**
 * Keep the Windows desktop entry for PHOENIX pointed at the durable checkout.
 *
 * Update staging worktrees intentionally do not create shortcuts: their .git
 * entry is a file and they are disposable. The primary checkout and the
 * external Windows supervisor are the only owners allowed to repair the link.
 */

import { spawnSync as nodeSpawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { existsSync as nodeExistsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

/** Resolve the durable files used by the Windows desktop shortcut. */
export function phoenixDesktopShortcutSpec(root, env = process.env, sourceRoot = root) {
  const resolvedRoot = resolve(root)
  const resolvedSourceRoot = resolve(sourceRoot)
  const systemRoot = env.SystemRoot ?? env.WINDIR
  return {
    root: resolvedRoot,
    sourceRoot: resolvedSourceRoot,
    setupScript: join(resolvedSourceRoot, 'scripts', 'phoenix-desktop-shortcut.ps1'),
    launchScript: join(resolvedRoot, 'scripts', 'phoenix-desktop-launch.ps1'),
    iconSource: join(resolvedSourceRoot, 'apps', 'web', 'public', 'phoenix-emblem.png'),
    powershell: systemRoot === undefined || systemRoot.trim().length === 0
      ? 'powershell.exe'
      : join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  }
}

// Multiple full Windows checkouts (e.g. AppData and OneDrive) may run their
// own postinstall hooks. Persist one canonical shortcut owner OUTSIDE either
// checkout, and allow a different checkout to replace it only when Git proves
// that its source commit is a strictly newer descendant. Older installers
// must never re-point Phoenix.lnk back to an obsolete Host.
const ownerRecordPath = join(homedir(), '.dsh', 'phoenix-desktop-owner.json')

function gitOutput(root, args) {
  const result = nodeSpawnSync('git', ['-C', root, ...args], {
    windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  })
  return result.status === 0 ? result.stdout?.trim() : undefined
}

function officialSourceHead(root) {
  const origin = gitOutput(root, ['remote', 'get-url', 'origin'])
  const normalized = origin?.replaceAll('\\', '/').replace(/\.git$/iu, '').toLowerCase()
  if (normalized !== 'https://github.com/arisnachy/phoenix-harnes'
    && normalized !== 'git@github.com:arisnachy/phoenix-harnes') return undefined
  const head = gitOutput(root, ['rev-parse', 'HEAD'])
  return /^[0-9a-f]{40}$/iu.test(head ?? '') ? head : undefined
}

function desktopOwnershipDecision(root, sourceRoot) {
  const candidateHead = officialSourceHead(sourceRoot)
  if (candidateHead === undefined) return { allowed: true }
  let prior
  try { prior = JSON.parse(readFileSync(ownerRecordPath, 'utf8')) } catch { /* first install */ }
  if (prior?.schema === 1 && typeof prior.root === 'string'
    && resolve(prior.root).toLowerCase() !== resolve(root).toLowerCase()) {
    const existingHead = officialSourceHead(prior.root)
    if (existingHead !== undefined) {
      const newer = existingHead !== candidateHead
        && nodeSpawnSync('git', ['-C', sourceRoot, 'merge-base', '--is-ancestor', existingHead, candidateHead], {
          windowsHide: true, stdio: 'ignore',
        }).status === 0
      if (!newer) return { allowed: false }
    }
  }
  return { allowed: true, candidateHead }
}

function persistDesktopOwnership(root, candidateHead) {
  if (candidateHead === undefined) return
  try {
    mkdirSync(dirname(ownerRecordPath), { recursive: true })
    const temp = `${ownerRecordPath}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify({ schema: 1, root: resolve(root), head: candidateHead }) + '\n')
    renameSync(temp, ownerRecordPath)
  } catch (error) {
    console.error(`[PHOENIX] warning: shortcut ownership marker could not be persisted: ${error instanceof Error ? error.message : String(error)}`)
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
  const sourceRoot = options.sourceRoot ?? root
  const spec = phoenixDesktopShortcutSpec(root, env, sourceRoot)
  const ownership = desktopOwnershipDecision(root, sourceRoot)
  if (!ownership.allowed) return { status: 'skipped-older-checkout' }

  if (!existsSync(spec.setupScript)) {
    throw new Error(`desktop shortcut setup script is missing: ${spec.setupScript}`)
  }
  if (!existsSync(spec.launchScript)) {
    throw new Error(`desktop launcher script is missing: ${spec.launchScript}`)
  }
  if (!existsSync(spec.iconSource)) {
    throw new Error(`desktop icon asset is missing: ${spec.iconSource}`)
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
    '-AssetRoot',
    spec.sourceRoot,
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
  persistDesktopOwnership(root, ownership.candidateHead)
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
