/**
 * Keep the locally installed OpenAI Codex CLI on the stable npm dist-tag.
 *
 * This watcher is intentionally independent from PHOENIX's own stable updater:
 * a failed package-manager probe/update must never block the Host, and Codex can
 * advance between PHOENIX releases. Only an unambiguous npm/pnpm installation
 * is mutated automatically; unknown/ambiguous installations remain notify-only.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_POLL_MS = 10 * 60 * 1000
const MIN_POLL_MS = 60 * 1000
const STATE_SCHEMA = 1
const PACKAGE = '@openai/codex'

/** Normalize the Codex update mode. */
export function normalizeCodexUpdateMode(value) {
  const mode = String(value).trim().toLowerCase()
  if (!['auto', 'notify', 'off'].includes(mode)) {
    throw new Error(`PHOENIX_CODEX_UPDATE_MODE must be auto, notify, or off; got ${JSON.stringify(value)}`)
  }
  return mode
}

/** Parse the first semantic version emitted by Codex/package-manager output. */
export function parseCodexVersion(value) {
  const match = /(?:^|\s|["'])v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?=$|\s|["'])/u.exec(String(value))
  if (match === null) return undefined
  const [, major, minor, patch, prerelease] = match
  return {
    raw: `${major}.${minor}.${patch}${prerelease === undefined ? '' : `-${prerelease}`}`,
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    ...(prerelease === undefined ? {} : { prerelease }),
  }
}

function comparePrerelease(left, right) {
  if (left === undefined && right === undefined) return 0
  if (left === undefined) return 1
  if (right === undefined) return -1
  const a = left.split('.')
  const b = right.split('.')
  const size = Math.max(a.length, b.length)
  for (let index = 0; index < size; index += 1) {
    const l = a[index]
    const r = b[index]
    if (l === undefined) return -1
    if (r === undefined) return 1
    if (l === r) continue
    const ln = /^\d+$/u.test(l) ? Number(l) : undefined
    const rn = /^\d+$/u.test(r) ? Number(r) : undefined
    if (ln !== undefined && rn !== undefined) return Math.sign(ln - rn)
    if (ln !== undefined) return -1
    if (rn !== undefined) return 1
    return Math.sign(l.localeCompare(r))
  }
  return 0
}

/** Compare two semantic versions. */
export function compareCodexVersions(leftValue, rightValue) {
  const left = typeof leftValue === 'string' ? parseCodexVersion(leftValue) : leftValue
  const right = typeof rightValue === 'string' ? parseCodexVersion(rightValue) : rightValue
  if (left === undefined || right === undefined) throw new Error('invalid Codex semantic version')
  for (const key of ['major', 'minor', 'patch']) {
    const delta = left[key] - right[key]
    if (delta !== 0) return Math.sign(delta)
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

/** Classify installed Codex against the stable npm dist-tag. */
export function classifyCodexUpdate(currentValue, latestValue) {
  const current = typeof currentValue === 'string' ? parseCodexVersion(currentValue) : currentValue
  const latest = typeof latestValue === 'string' ? parseCodexVersion(latestValue) : latestValue
  if (current === undefined || latest === undefined || latest.prerelease !== undefined) return 'invalid'
  const comparison = compareCodexVersions(current, latest)
  if (comparison === 0) return 'current'
  return comparison < 0 ? 'available' : 'ahead'
}

function walkForPackageVersion(value) {
  if (value === null || typeof value !== 'object') return undefined
  if (!Array.isArray(value)) {
    const object = value
    const dependencies = object.dependencies
    if (dependencies !== null && typeof dependencies === 'object' && !Array.isArray(dependencies)) {
      const direct = dependencies[PACKAGE]
      if (direct !== null && typeof direct === 'object' && typeof direct.version === 'string') {
        return parseCodexVersion(direct.version)?.raw
      }
    }
    if (object.name === PACKAGE && typeof object.version === 'string') {
      return parseCodexVersion(object.version)?.raw
    }
    for (const nested of Object.values(object)) {
      const found = walkForPackageVersion(nested)
      if (found !== undefined) return found
    }
    return undefined
  }
  for (const nested of value) {
    const found = walkForPackageVersion(nested)
    if (found !== undefined) return found
  }
  return undefined
}

/** Extract @openai/codex's version from npm/pnpm JSON list output. */
export function packageVersionFromListJson(value) {
  let parsed
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value
  } catch {
    return undefined
  }
  return walkForPackageVersion(parsed)
}

function normalizedPath(value) {
  const cleaned = normalize(String(value).trim()).replace(/[\\/]+$/u, '')
  return process.platform === 'win32' ? cleaned.toLowerCase() : cleaned
}

function pathInside(path, directory) {
  const candidate = normalizedPath(path)
  const root = normalizedPath(directory)
  return candidate === root || candidate.startsWith(`${root}${process.platform === 'win32' ? '\\' : '/'}`)
}

/**
 * Select the package manager that owns the active Codex command.
 *
 * Version equality is mandatory. Path ownership disambiguates when both npm and
 * pnpm happen to carry the same Codex version. Ambiguity deliberately disables
 * automatic mutation instead of guessing.
 */
export function chooseCodexPackageManager(input) {
  const current = parseCodexVersion(input.currentVersion)?.raw
  if (current === undefined) return undefined
  const matching = input.managers.filter(manager => parseCodexVersion(manager.version)?.raw === current)
  if (matching.length === 0) return undefined
  const byPath = matching.filter(manager =>
    input.codexPaths.some(path => manager.binDirs.some(directory => pathInside(path, directory))))
  if (byPath.length === 1) return byPath[0].name
  if (byPath.length > 1) return undefined
  return matching.length === 1 ? matching[0].name : undefined
}

function command(bin, args, options = {}) {
  const result = spawnSync(bin, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout ?? 30_000,
  })
  if (result.error !== undefined) {
    if (result.error.code === 'ENOENT') return { ok: false, missing: true, stdout: '', stderr: '' }
    return { ok: false, error: result.error, stdout: '', stderr: '' }
  }
  return {
    ok: result.status === 0,
    stdout: typeof result.stdout === 'string' ? result.stdout.trim() : '',
    stderr: typeof result.stderr === 'string' ? result.stderr.trim() : '',
    status: result.status,
  }
}

function safeHome() {
  const configured = process.env.DSH_HOME?.trim()
  if (configured) return resolve(configured)
  const user = process.env.USERPROFILE?.trim() || process.env.HOME?.trim() || homedir()
  return resolve(user, '.dsh')
}

function statePath(home) {
  return join(home, 'phoenix-codex-update.json')
}

function managedRuntimeRoot(home) {
  const configured = process.env.PHOENIX_CODEX_RUNTIME_ROOT?.trim()
  return configured ? resolve(configured) : join(home, 'codex-runtime')
}

function managedPackageVersion(root) {
  const manifest = join(root, 'node_modules', '@openai', 'codex', 'package.json')
  if (!existsSync(manifest)) return undefined
  try {
    const value = JSON.parse(readFileSync(manifest, 'utf8'))
    return typeof value?.version === 'string' ? parseCodexVersion(value.version)?.raw : undefined
  } catch {
    return undefined
  }
}

function ensureManagedRuntimeManifest(root) {
  mkdirSync(root, { recursive: true })
  const manifest = join(root, 'package.json')
  if (existsSync(manifest)) return
  writeFileSync(manifest, JSON.stringify({
    name: 'phoenix-codex-runtime',
    version: '0.0.0',
    private: true,
  }, null, 2) + '\n', 'utf8')
}

function managedRuntimeInstallCommand(root, version) {
  if (packageCommand('npm', ['--version']).ok) {
    return ['npm', ['install', '--prefix', root, '--no-save', `${PACKAGE}@${version}`]]
  }
  if (packageCommand('pnpm', ['--version']).ok) {
    return ['pnpm', ['add', '--dir', root, '--save-exact', `${PACKAGE}@${version}`]]
  }
  return undefined
}

function installManagedRuntime(root, version) {
  ensureManagedRuntimeManifest(root)
  const update = managedRuntimeInstallCommand(root, version)
  if (update === undefined) return { ok: false, detail: 'npm/pnpm is unavailable for the Phoenix-managed Codex runtime.' }
  const [bin, args] = update
  const result = packageCommand(bin, args, { timeout: 5 * 60 * 1000 })
  if (!result.ok) return { ok: false, detail: `${bin} could not install ${PACKAGE}@${version} into the Phoenix-managed runtime.` }
  const verified = managedPackageVersion(root)
  if (verified === undefined || compareCodexVersions(verified, version) < 0) {
    return { ok: false, detail: 'Managed Codex installation completed but did not resolve to the requested stable version.' }
  }
  return { ok: true, version: verified, manager: bin }
}

function writeState(home, value) {
  const path = statePath(home)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ schema: STATE_SCHEMA, checkedAt: new Date().toISOString(), ...value }, null, 2)}\n`, 'utf8')
}

function readState(home) {
  const path = statePath(home)
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

function packageCommand(bin, args, options = {}) {
  return command(bin, args, { ...options, cwd: homedir() })
}

function activeCodexVersion() {
  const result = command('codex', ['--version'], { cwd: homedir() })
  if (!result.ok) return undefined
  return parseCodexVersion(result.stdout)?.raw
}

function codexPaths() {
  const result = process.platform === 'win32'
    ? command(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'where codex'])
    : command('which', ['-a', 'codex'])
  if (!result.ok) return []
  return result.stdout.split(/\r?\n/u).map(value => value.trim()).filter(value => value.length > 0)
}

function npmBinDirs() {
  const prefix = packageCommand('npm', ['prefix', '-g'])
  if (!prefix.ok || prefix.stdout.length === 0) return []
  const root = resolve(prefix.stdout)
  return process.platform === 'win32' ? [root] : [join(root, 'bin')]
}

function pnpmBinDirs() {
  const bin = packageCommand('pnpm', ['bin', '-g'])
  if (!bin.ok || bin.stdout.length === 0) return []
  return [resolve(bin.stdout)]
}

function installedPackageVersion(manager) {
  const result = packageCommand(manager, ['list', '-g', PACKAGE, '--depth=0', '--json'])
  if (!result.ok && result.stdout.length === 0) return undefined
  return packageVersionFromListJson(result.stdout)
}

function inspectManager(currentVersion) {
  const managers = [
    { name: 'npm', version: installedPackageVersion('npm'), binDirs: npmBinDirs() },
    { name: 'pnpm', version: installedPackageVersion('pnpm'), binDirs: pnpmBinDirs() },
  ].filter(manager => manager.version !== undefined)
  const paths = codexPaths()
  const manager = chooseCodexPackageManager({
    currentVersion,
    codexPaths: paths,
    managers,
  })
  return { manager, paths, managers }
}

function latestStableVersion() {
  for (const manager of ['npm', 'pnpm']) {
    const result = packageCommand(manager, ['view', PACKAGE, 'version', '--json'], { timeout: 45_000 })
    if (!result.ok || result.stdout.length === 0) continue
    let value = result.stdout
    try {
      const parsed = JSON.parse(result.stdout)
      if (typeof parsed === 'string') value = parsed
    } catch {
      // Plain text is accepted below.
    }
    const version = parseCodexVersion(value)
    if (version !== undefined && version.prerelease === undefined) return version.raw
  }
  return undefined
}

function codexBusy() {
  if (process.platform === 'win32') {
    const result = command('tasklist', ['/FI', 'IMAGENAME eq codex.exe', '/NH'])
    return result.ok && /\bcodex\.exe\b/iu.test(result.stdout)
  }
  const result = command('pgrep', ['-x', 'codex'])
  return result.ok && result.stdout.length > 0
}

function updateCommand(manager) {
  if (manager === 'npm') return ['npm', ['install', '-g', `${PACKAGE}@latest`]]
  if (manager === 'pnpm') return ['pnpm', ['add', '-g', `${PACKAGE}@latest`]]
  return undefined
}

function publicInspection(home) {
  const latest = latestStableVersion()
  const runtimeRoot = managedRuntimeRoot(home)
  const managedCurrent = managedPackageVersion(runtimeRoot)
  const current = activeCodexVersion()
  const status = latest === undefined
    ? 'unavailable'
    : current === undefined
      ? 'not-installed'
      : classifyCodexUpdate(current, latest)
  const managedStatus = latest === undefined
    ? 'unavailable'
    : managedCurrent === undefined
      ? 'missing'
      : classifyCodexUpdate(managedCurrent, latest)
  const ownership = current === undefined
    ? { manager: undefined, paths: codexPaths(), managers: [] }
    : inspectManager(current)
  return {
    status,
    managedStatus,
    current,
    managedCurrent,
    latest,
    runtimeRoot,
    manager: ownership.manager,
    codexPaths: ownership.paths,
    managers: ownership.managers.map(manager => ({ name: manager.name, version: manager.version })),
  }
}

/** Inspect Codex without mutating it. Exported for diagnostics/tests. */
export function inspectCodexUpdate(home = safeHome()) {
  const inspection = publicInspection(home)
  writeState(home, inspection)
  return inspection
}

function cycle(home, mode, options = {}) {
  if (mode === 'off') {
    writeState(home, { mode, status: 'off' })
    return 0
  }
  const inspection = publicInspection(home)
  writeState(home, { mode, ...inspection })

  if (inspection.latest === undefined) return inspection.status === 'invalid' ? 1 : 0
  const managedNeedsUpdate = inspection.managedStatus === 'missing' || inspection.managedStatus === 'available'
  const globalNeedsUpdate = inspection.status === 'available'
  if (!managedNeedsUpdate && !globalNeedsUpdate) return 0
  if (mode === 'notify' && options.apply !== true) {
    writeState(home, { mode, ...inspection, status: 'available' })
    return 0
  }
  if (codexBusy()) {
    writeState(home, {
      mode,
      ...inspection,
      status: 'deferred',
      detail: 'Codex is currently in use; the stable update will be retried after active Codex processes exit.',
    })
    return 0
  }

  let managedCurrent = inspection.managedCurrent
  let managedManager
  if (managedNeedsUpdate) {
    writeState(home, { mode, ...inspection, status: 'updating-managed' })
    const managed = installManagedRuntime(inspection.runtimeRoot, inspection.latest)
    if (!managed.ok) {
      writeState(home, {
        mode,
        ...inspection,
        status: 'blocked',
        detail: managed.detail,
      })
      return 1
    }
    managedCurrent = managed.version
    managedManager = managed.manager
  }

  let current = inspection.current
  let globalDetail
  if (globalNeedsUpdate) {
    if (inspection.manager === undefined) {
      globalDetail = 'The active global Codex installation is ambiguous or unsupported; Phoenix updated its managed runtime and left the global command unchanged.'
    } else {
      const update = updateCommand(inspection.manager)
      if (update !== undefined) {
        writeState(home, {
          mode,
          ...inspection,
          managedCurrent,
          status: 'updating-global',
        })
        const [bin, args] = update
        const result = packageCommand(bin, args, { timeout: 5 * 60 * 1000 })
        if (!result.ok) {
          writeState(home, {
            mode,
            ...inspection,
            managedCurrent,
            status: managedNeedsUpdate ? 'partial' : 'blocked',
            detail: `${inspection.manager} could not update the global ${PACKAGE} command; the Phoenix-managed runtime is ${managedCurrent ?? 'unchanged'}.`,
          })
          return 1
        }
        const verified = activeCodexVersion()
        if (verified === undefined || compareCodexVersions(verified, inspection.latest) < 0) {
          writeState(home, {
            mode,
            ...inspection,
            managedCurrent,
            status: managedNeedsUpdate ? 'partial' : 'blocked',
            detail: 'Global Codex update completed but the active codex command did not resolve to the requested stable version.',
            verified,
          })
          return 1
        }
        current = verified
      }
    }
  }

  writeState(home, {
    mode,
    status: 'applied',
    previous: inspection.current,
    current,
    managedPrevious: inspection.managedCurrent,
    managedCurrent,
    latest: inspection.latest,
    runtimeRoot: inspection.runtimeRoot,
    ...managedManager === undefined ? {} : { managedManager },
    ...inspection.manager === undefined ? {} : { manager: inspection.manager },
    ...globalDetail === undefined ? {} : { detail: globalDetail },
  })
  return 0
}

function parentAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function pollInterval() {
  const value = Number(process.env.PHOENIX_CODEX_UPDATE_POLL_MS ?? DEFAULT_POLL_MS)
  if (!Number.isFinite(value)) return DEFAULT_POLL_MS
  return Math.max(MIN_POLL_MS, Math.floor(value))
}

const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))

async function watch(home, mode, parentPid) {
  while (parentAlive(parentPid)) {
    try {
      cycle(home, mode, { apply: mode === 'auto' })
    } catch (error) {
      writeState(home, {
        mode,
        status: 'blocked',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
    const deadline = Date.now() + pollInterval()
    while (parentAlive(parentPid) && Date.now() < deadline) {
      await sleep(Math.min(1_000, Math.max(0, deadline - Date.now())))
    }
  }
}

function doctor(home, mode) {
  const state = readState(home)
  const current = activeCodexVersion()
  process.stdout.write(`PHOENIX Codex update mode: ${mode}\n`)
  process.stdout.write(current === undefined ? 'INFO Codex CLI not installed\n' : `PASS active Codex ${current}\n`)
  if (state !== undefined) process.stdout.write(`INFO last update state: ${String(state.status ?? 'unknown')}\n`)
  return current === undefined ? 1 : 0
}

function printHelp() {
  process.stdout.write(
    'PHOENIX Codex CLI stable updater\n\n'
    + 'Commands:\n'
    + '  node scripts/phoenix-codex-update.mjs --check\n'
    + '  node scripts/phoenix-codex-update.mjs --apply\n'
    + '  node scripts/phoenix-codex-update.mjs --doctor\n\n'
    + 'Environment:\n'
    + '  PHOENIX_CODEX_UPDATE_MODE=auto|notify|off\n'
    + '  PHOENIX_CODEX_UPDATE_POLL_MS=milliseconds (minimum 60000)\n',
  )
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    printHelp()
    return 0
  }
  const mode = normalizeCodexUpdateMode(process.env.PHOENIX_CODEX_UPDATE_MODE ?? 'auto')
  const home = safeHome()
  if (args.includes('--doctor')) return doctor(home, mode)
  if (args.includes('--watch')) {
    const index = args.indexOf('--parent-pid')
    const parentPid = Number(index >= 0 ? args[index + 1] : NaN)
    if (!Number.isInteger(parentPid) || parentPid <= 0) throw new Error('--watch requires --parent-pid <pid>')
    await watch(home, mode, parentPid)
    return 0
  }
  if (args.includes('--apply')) return cycle(home, mode, { apply: true })
  return cycle(home, mode, { apply: false })
}

if (process.argv[1] !== undefined && isAbsolute(process.argv[1])
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().then(code => { process.exitCode = code }).catch(error => {
    process.stderr.write(`PHOENIX Codex update: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
