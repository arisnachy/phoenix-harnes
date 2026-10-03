#!/usr/bin/env node
/**
 * Keep PHOENIX on the latest stable official Codex CLI without mutating the
 * source checkout. A versioned npm runtime is staged under DSH_HOME, smoke
 * tested, then selected atomically through codex-cli/active.json.
 */

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const STATE_SCHEMA = 1
const DEFAULT_POLL_MS = 6 * 60 * 60 * 1000
const MIN_POLL_MS = 30 * 60 * 1000
const REGISTRY_URL = 'https://registry.npmjs.org/@openai%2fcodex/latest'
const PACKAGE_NAME = '@openai/codex'

/** Normalize the managed Codex updater mode. */
export function normalizeCodexUpdateMode(value) {
  const mode = String(value).trim().toLowerCase()
  if (!['auto', 'notify', 'off'].includes(mode)) {
    throw new Error(`PHOENIX_CODEX_UPDATE_MODE must be auto, notify, or off; got ${JSON.stringify(value)}`)
  }
  return mode
}

/** Parse one stable Codex x.y.z version and reject prerelease tags. */
export function parseStableVersion(value) {
  const match = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/u.exec(String(value).trim())
  if (match?.groups === undefined) throw new Error(`invalid stable Codex version ${JSON.stringify(value)}`)
  return {
    text: `${Number(match.groups.major)}.${Number(match.groups.minor)}.${Number(match.groups.patch)}`,
    parts: [Number(match.groups.major), Number(match.groups.minor), Number(match.groups.patch)],
  }
}

/** Compare two stable Codex semantic versions numerically. */
export function compareStableVersions(left, right) {
  const a = parseStableVersion(left).parts
  const b = parseStableVersion(right).parts
  for (let index = 0; index < 3; index += 1) {
    const delta = a[index] - b[index]
    if (delta !== 0) return delta < 0 ? -1 : 1
  }
  return 0
}

function dshHome() {
  const configured = process.env.DSH_HOME?.trim()
  return configured && configured.length > 0 ? resolve(configured) : join(homedir(), '.dsh')
}

function runtimeRoot(home) {
  return join(home, 'codex-cli')
}

function versionsRoot(home) {
  return join(runtimeRoot(home), 'versions')
}

function markerPath(home) {
  return join(runtimeRoot(home), 'active.json')
}

function statePath(home) {
  return join(runtimeRoot(home), 'update-state.json')
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${String(process.pid)}`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    renameSync(temporary, path)
  } catch (error) {
    if (process.platform !== 'win32' || !['EEXIST', 'EPERM', 'EACCES'].includes(error?.code)) throw error
    rmSync(path, { force: true })
    renameSync(temporary, path)
  }
}

function saveState(home, state) {
  writeJsonAtomic(statePath(home), {
    schema: STATE_SCHEMA,
    ...state,
    checkedAt: new Date().toISOString(),
  })
}

/** Read the active PHOENIX-managed Codex runtime without trusting path traversal. */
export function readActiveCodexRuntime(home) {
  const root = runtimeRoot(home)
  const path = markerPath(home)
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (value?.schema !== 1 || typeof value.version !== 'string'
      || typeof value.bin !== 'string') return undefined
    const version = parseStableVersion(value.version).text
    const bin = resolve(root, value.bin)
    const boundary = root.endsWith(sep) ? root : `${root}${sep}`
    if (bin !== root && !bin.startsWith(boundary)) return undefined
    if (!existsSync(bin)) return undefined
    return { version, bin }
  } catch {
    return undefined
  }
}

async function latestStableVersion() {
  const response = await fetch(REGISTRY_URL, {
    headers: { 'user-agent': 'phoenix-codex-updater/1' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`npm registry returned HTTP ${String(response.status)}`)
  const payload = await response.json()
  return parseStableVersion(payload?.version).text
}

function npmInvocation(args) {
  if (process.platform !== 'win32') return { bin: 'npm', args }
  const bundledNpm = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (existsSync(bundledNpm)) return { bin: process.execPath, args: [bundledNpm, ...args] }
  const shell = process.env.ComSpec ?? 'cmd.exe'
  const quote = value => `"${String(value).replaceAll('"', '""').replaceAll('%', '%%')}"`
  return { bin: shell, args: ['/d', '/s', '/c', ['npm', ...args].map(quote).join(' ')] }
}

function run(bin, args, options = {}) {
  const result = spawnSync(bin, args, {
    cwd: options.cwd,
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout,
  })
  if (result.error !== undefined) throw result.error
  if ((result.status ?? 1) !== 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
    const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : ''
    throw new Error(`${bin} ${args.join(' ')} failed${stderr || stdout ? `: ${stderr || stdout}` : ''}`)
  }
  return typeof result.stdout === 'string' ? result.stdout.trim() : ''
}

function packageBin(prefix) {
  const manifestPath = join(prefix, 'node_modules', '@openai', 'codex', 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (typeof manifest?.version !== 'string') throw new Error('installed Codex package has no version')
  const binRelative = typeof manifest?.bin === 'object' && manifest.bin !== null
    ? manifest.bin.codex
    : undefined
  if (typeof binRelative !== 'string' || binRelative.trim().length === 0) {
    throw new Error('installed Codex package has no codex binary')
  }
  return {
    version: parseStableVersion(manifest.version).text,
    bin: resolve(dirname(manifestPath), binRelative),
  }
}

function smokeCodex(bin, expectedVersion) {
  const output = run(process.execPath, [bin, '--version'], { timeout: 30_000 })
  if (!output.includes(expectedVersion)) {
    throw new Error(`Codex smoke test returned ${JSON.stringify(output)} instead of ${expectedVersion}`)
  }
}

function installVersion(home, version) {
  const versions = versionsRoot(home)
  mkdirSync(versions, { recursive: true })
  const target = join(versions, version)
  if (existsSync(target)) {
    try {
      const installed = packageBin(target)
      if (installed.version === version) {
        smokeCodex(installed.bin, version)
        return installed.bin
      }
    } catch {
      rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 })
    }
  }

  const staging = join(versions, `.staging-${version}-${String(process.pid)}-${Date.now().toString(36)}`)
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  try {
    const npm = npmInvocation([
      'install',
      '--prefix', staging,
      '--no-package-lock',
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      `${PACKAGE_NAME}@${version}`,
    ])
    run(npm.bin, npm.args, { inherit: true, timeout: 5 * 60 * 1000 })
    const installed = packageBin(staging)
    if (installed.version !== version) {
      throw new Error(`npm installed Codex ${installed.version}, expected ${version}`)
    }
    smokeCodex(installed.bin, version)
    if (existsSync(target)) rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 })
    renameSync(staging, target)
    return packageBin(target).bin
  } catch (error) {
    rmSync(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 })
    throw error
  }
}

function activateVersion(home, version, bin) {
  const root = runtimeRoot(home)
  const relativeBin = relative(root, bin).replace(/\\/gu, '/')
  if (relativeBin.startsWith('../') || relativeBin === '..') throw new Error('managed Codex binary escaped runtime root')
  writeJsonAtomic(markerPath(home), {
    schema: 1,
    version,
    bin: relativeBin,
    activatedAt: new Date().toISOString(),
  })
}

/** Remove inactive managed Codex versions and abandoned staging directories. */
export function pruneManagedCodexVersions(home, activeVersion) {
  const versions = versionsRoot(home)
  if (!existsSync(versions)) return { removed: 0 }
  let removed = 0
  for (const entry of readdirSync(versions, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name === activeVersion) continue
    if (!/^\d+\.\d+\.\d+$/u.test(entry.name) && !entry.name.startsWith('.staging-')) continue
    try {
      rmSync(join(versions, entry.name), { recursive: true, force: true, maxRetries: 3, retryDelay: 250 })
      removed += 1
    } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error?.code)) throw error
      // A still-running Codex process can keep its previous Windows executable
      // locked. The active marker already points at the new version; leave the
      // old directory for the next maintenance pass instead of failing update.
    }
  }
  return { removed }
}

async function cycle(home, mode, options = {}) {
  const quiet = options.quiet === true
  if (mode === 'off') {
    saveState(home, { mode, status: 'off' })
    return 0
  }

  try {
    const latest = await latestStableVersion()
    const active = readActiveCodexRuntime(home)
    if (active !== undefined && compareStableVersions(active.version, latest) >= 0) {
      const cleaned = pruneManagedCodexVersions(home, active.version)
      saveState(home, { mode, status: 'current', currentVersion: active.version, latestVersion: latest, cleaned })
      if (!quiet) process.stdout.write(`PASS Codex CLI: ${active.version} is current.\n`)
      return 0
    }

    saveState(home, {
      mode,
      status: 'available',
      ...(active === undefined ? {} : { currentVersion: active.version }),
      latestVersion: latest,
    })
    if (!quiet) {
      process.stdout.write(`UPDATE Codex CLI: ${active?.version ?? 'unmanaged'} -> ${latest}\n`)
    }
    if (mode === 'notify' || options.apply !== true) return 0

    const bin = installVersion(home, latest)
    activateVersion(home, latest, bin)
    const cleaned = pruneManagedCodexVersions(home, latest)
    saveState(home, {
      mode,
      status: 'applied',
      previousVersion: active?.version,
      currentVersion: latest,
      latestVersion: latest,
      cleaned,
    })
    if (!quiet) process.stdout.write(`PASS Codex CLI ${latest} downloaded, smoke-tested, and activated for PHOENIX.\n`)
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    saveState(home, { mode, status: 'blocked', error: message })
    if (!quiet) process.stderr.write(`BLOCKED Codex CLI update: ${message}\n`)
    return 1
  }
}

function parentAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function pollInterval() {
  const configured = Number(process.env.PHOENIX_CODEX_UPDATE_POLL_MS ?? DEFAULT_POLL_MS)
  if (!Number.isFinite(configured)) return DEFAULT_POLL_MS
  return Math.max(MIN_POLL_MS, Math.floor(configured))
}

const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))

async function waitForPollOrParentExit(parentPid, waitMs) {
  const deadline = Date.now() + waitMs
  while (parentAlive(parentPid) && Date.now() < deadline) {
    await sleep(Math.min(1_000, Math.max(0, deadline - Date.now())))
  }
}

async function watch(home, mode, parentPid) {
  while (parentAlive(parentPid)) {
    await cycle(home, mode, { apply: mode === 'auto', quiet: true })
    await waitForPollOrParentExit(parentPid, pollInterval())
  }
}

function printHelp() {
  process.stdout.write(
    'PHOENIX Codex CLI updater\n\n'
    + 'Commands:\n  dsh codex-update --check\n  dsh codex-update --apply\n  dsh codex-update --doctor\n\n'
    + 'Environment:\n  PHOENIX_CODEX_UPDATE_MODE=auto|notify|off\n'
    + '  PHOENIX_CODEX_UPDATE_POLL_MS=milliseconds (minimum 1800000)\n\n'
    + 'Auto mode checks the official npm latest tag, installs only stable x.y.z releases, '
    + 'smoke-tests them, and switches PHOENIX atomically without modifying the source checkout.\n',
  )
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    printHelp()
    return 0
  }
  const mode = normalizeCodexUpdateMode(process.env.PHOENIX_CODEX_UPDATE_MODE ?? 'auto')
  const home = dshHome()
  if (args.includes('--doctor')) {
    const active = readActiveCodexRuntime(home)
    const latest = await latestStableVersion()
    process.stdout.write(`Codex CLI active: ${active?.version ?? 'none'}\nCodex CLI latest stable: ${latest}\n`)
    return active !== undefined && compareStableVersions(active.version, latest) >= 0 ? 0 : 1
  }
  if (args.includes('--watch')) {
    const index = args.indexOf('--parent-pid')
    const parentPid = Number(index >= 0 ? args[index + 1] : NaN)
    if (!Number.isInteger(parentPid) || parentPid <= 0) throw new Error('--watch requires --parent-pid <pid>')
    await watch(home, mode, parentPid)
    return 0
  }
  if (args.includes('--apply')) return await cycle(home, mode, { apply: true })
  return await cycle(home, mode, { apply: false })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code }).catch((error) => {
    process.stderr.write(`PHOENIX Codex CLI update: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
