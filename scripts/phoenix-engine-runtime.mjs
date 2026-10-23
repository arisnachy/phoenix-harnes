import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  openSync,
  writeSync,
  writeFileSync,
} from 'node:fs'
import { dirname, relative, resolve, join, isAbsolute } from 'node:path'
import process from 'node:process'
import {
  executeOpenClawRuntimeRetention,
  planOpenClawRuntimeRetention,
} from './phoenix-runtime-retention.mjs'

const SCHEMA = 1
export const ENGINE_RUNTIME_SAFETY_VERSION = 2
const OPENCLAW_CLIENT_MODULE = new URL('../packages/subagent/subagent-openclaw/lib/index.js', import.meta.url)
const RUNTIME_DIRECTORY = 'openclaw-runtime'
const CANDIDATE_FILE = 'candidate.json'
const ACTIVE_FILE = 'active.json'
const PREVIOUS_FILE = 'previous.json'
const RUNTIME_BLOCKED_FILE = '.runtime-blocked.json'
const PHOENIX_MARKER = '.phoenix-managed-install'
const PHOENIX_ACTIVE_RUNTIME = 'phoenix-active-runtime.json'
const PHOENIX_UPDATE_STATE = 'phoenix-update-state.json'
const CODEX_RUNTIME_DIRECTORY = 'codex-cli'
const CODEX_ACTIVE_FILE = 'active.json'
const SHARED_LOCK_FILE = '.runtime.lock'
const SHARED_LOCK_RECOVERY_FILE = '.runtime.lock.recovery'
const PREPARE_LOCK_FILE = '.prepare.lock'
const LIFECYCLE_LOCK_FILE = '.lifecycle.lock'
const OFFICIAL_OPENCLAW_REPOSITORY = 'openclaw/openclaw'
const OFFICIAL_OPENCLAW_REGISTRY = 'https://registry.npmjs.org'
const OFFICIAL_NODE_VERSION = '24.22.1'
const OFFICIAL_NODE_PLATFORM = 'win-x64'
const MAX_METADATA_BYTES = 1 * 1024 * 1024
const MAX_SHASUMS_BYTES = 2 * 1024 * 1024
const MAX_OPENCLAW_TARBALL_BYTES = 128 * 1024 * 1024
const MAX_NODE_ARCHIVE_BYTES = 256 * 1024 * 1024
const MAX_OPENCLAW_ARCHIVE_BYTES = 512 * 1024 * 1024
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120_000
const DEFAULT_PROCESS_TIMEOUT_MS = 120_000
const DEFAULT_INSTALL_TIMEOUT_MS = 1_200_000
const DEFAULT_PORT = 18789
const DEFAULT_HEALTH_TIMEOUT_MS = 5000
const DEFAULT_STARTUP_TIMEOUT_MS = 600_000
const DEFAULT_HEALTH_INTERVAL_MS = 100
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024
const LIVE_PHASES = new Set(['reserved', 'prepared', 'dispatching', 'running', 'uncertain'])
const SAFE_ENVIRONMENT_KEYS = new Set([
  'PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE',
  'HOMEDRIVE', 'HOMEPATH', 'HOME', 'LANG', 'LC_ALL',
])
const SECRET_ENVIRONMENT_KEY = /(token|secret|password|api[_-]?key|credential|authorization|cookie)/iu
const INSPECTABLE_STATUSES = new Set(['active', 'blocked', 'current', 'failed', 'idle', 'none', 'prepared', 'preparing', 'ready', 'restarting', 'stopped', 'unavailable'])
const runningGateways = new Map()
const lifecycleTails = new Map()
const BOUNDED_TIMEOUT = Symbol('bounded-timeout')

function requireHome(home) {
  const value = home ?? process.env.DSH_HOME
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('home or DSH_HOME is required')
  return resolve(value)
}

function samePath(left, right) {
  const a = resolve(left)
  const b = resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/**
 * Reject a home/runtime path whose existing ancestors are links or reparse
 * points. Missing leaves are allowed so the manager can create a new isolated
 * runtime, but every existing ancestor must resolve to itself.
 */
function assertSafeDirectoryPath(path, { allowMissing = true } = {}) {
  const target = resolve(path)
  let current = target
  while (true) {
    try {
      const info = lstatSync(current)
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('OpenClaw runtime path is not a safe directory')
      if (!samePath(realpathSync(current), current)) throw new Error('OpenClaw runtime path contains a junction or reparse point')
      return target
    } catch (error) {
      if (error?.code !== 'ENOENT' || !allowMissing) throw Object.assign(new Error('OpenClaw runtime path is not a safe directory'), { code: 'OPENCLAW_UNSAFE_PATH', cause: error })
      const parent = dirname(current)
      if (samePath(parent, current)) return target
      current = parent
    }
  }
}

function pathsFor(home) {
  const resolvedHome = assertSafeDirectoryPath(requireHome(home))
  const root = assertSafeDirectoryPath(join(resolvedHome, RUNTIME_DIRECTORY))
  return {
    root,
    candidate: join(root, CANDIDATE_FILE),
    active: join(root, ACTIVE_FILE),
    previous: join(root, PREVIOUS_FILE),
  }
}

function isWithin(root, target) {
  const path = relative(resolve(root), resolve(target))
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

function writeJsonAtomic(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    try {
      renameSync(temporary, path)
    } catch (error) {
      // Replacing a marker must remain one rename operation. Deleting the
      // destination first creates a window in which an interrupted update
      // loses the last known-good state.
      if (['EACCES', 'EEXIST', 'EPERM'].includes(error?.code)) {
        throw Object.assign(new Error('Atomic marker replacement was refused by the filesystem'), { code: 'ATOMIC_MARKER_REPLACE_FAILED', cause: error })
      }
      throw error
    }
  } finally {
    rmSync(temporary, { force: true })
  }
}

function validVersion(version) {
  return typeof version === 'string' && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)
}

function officialTarball(version) {
  return `https://registry.npmjs.org/openclaw/-/openclaw-${version}.tgz`
}

function validateOfficialRegistry(candidate) {
  const registry = candidate?.registry
  if (registry?.name !== 'openclaw') throw new Error('OpenClaw registry package name is not official')
  if (registry?.repository !== 'openclaw/openclaw') throw new Error('OpenClaw registry repository is not official OpenClaw registry repository')
  if (!validVersion(candidate?.version) || registry.version !== candidate.version) throw new Error('OpenClaw version must be pinned and match registry metadata')
  if (registry.dist?.tarball !== officialTarball(candidate.version)) throw new Error('OpenClaw tarball must use the pinned npm registry URL')
  if (typeof registry.dist?.sha512 !== 'string' || !/^[a-f0-9]{128}$/iu.test(registry.dist.sha512)) throw new Error('OpenClaw dist sha512 metadata is required')
  return registry.dist.sha512.toLowerCase()
}

function requiredPath(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`OpenClaw ${name} is required`)
  return resolve(value)
}

function candidatePaths(home, candidate) {
  const runtimeRoot = pathsFor(home).root
  const runtimePath = requiredPath(candidate?.runtimePath, 'runtimePath')
  const entryPath = requiredPath(candidate?.entryPath, 'entryPath')
  const artifactPath = requiredPath(candidate?.artifactPath, 'artifactPath')
  const nodePath = requiredPath(candidate?.nodePath, 'nodePath')
  if (!isWithin(runtimeRoot, runtimePath)) throw new Error('OpenClaw runtimePath must stay under DSH_HOME/openclaw-runtime')
  if (!isWithin(runtimePath, entryPath)) throw new Error('OpenClaw entryPath must stay under its runtimePath')
  if (!isWithin(runtimeRoot, artifactPath)) throw new Error('OpenClaw artifactPath must stay under DSH_HOME/openclaw-runtime')
  try {
    const runtimeRootReal = realpathSync(runtimeRoot)
    const runtimePathReal = realpathSync(runtimePath)
    if (!isWithin(runtimeRootReal, runtimePathReal)) throw new Error('OpenClaw runtimePath resolves outside the isolated runtime')
  } catch (error) {
    if (error?.message?.startsWith('OpenClaw runtimePath')) throw error
    throw new Error('OpenClaw runtimePath is missing or cannot be resolved')
  }
  const nodeRoot = join(runtimeRoot, 'node')
  if (!isWithin(nodeRoot, nodePath)) throw new Error('OpenClaw nodePath must stay under DSH_HOME/openclaw-runtime/node')
  try {
    const nodeStat = lstatSync(nodePath)
    if (!nodeStat.isFile() || nodeStat.isSymbolicLink()) throw new Error('OpenClaw nodePath must be a regular isolated file')
    const runtimeRootReal = realpathSync(runtimeRoot)
    const nodeRootReal = realpathSync(nodeRoot)
    const nodePathReal = realpathSync(nodePath)
    if (!isWithin(runtimeRootReal, nodeRootReal) || !isWithin(nodeRootReal, nodePathReal)) throw new Error('OpenClaw nodePath resolves outside the isolated Node directory')
  } catch (error) {
    if (error?.message?.startsWith('OpenClaw nodePath')) throw error
    throw new Error('OpenClaw nodePath is missing or cannot be resolved')
  }
  return { runtimePath, entryPath, artifactPath, nodePath }
}

function hashFile(path) {
  return createHash('sha512').update(readFileSync(path)).digest('hex')
}

function digestTree(root, { excluded = new Set() } = {}) {
  const resolvedRoot = resolve(root)
  const files = {}
  const visit = current => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const target = resolve(current, entry.name)
      if (!isWithin(resolvedRoot, target)) throw new Error('Digest manifest path leaves its isolated tree')
      const relativePath = relative(resolvedRoot, target).replaceAll('\\', '/')
      if (excluded.has(relativePath)) continue
      const info = lstatSync(target)
      if (info.isSymbolicLink()) throw new Error('Digest manifest tree contains an unsafe symbolic link')
      if (entry.isDirectory()) {
        visit(target)
      } else if (entry.isFile()) {
        files[relativePath] = createHash('sha256').update(readFileSync(target)).digest('hex')
      } else {
        throw new Error('Digest manifest tree contains an unsupported filesystem entry')
      }
    }
  }
  visit(resolvedRoot)
  const normalized = Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)))
  return {
    schema: SCHEMA,
    algorithm: 'sha256',
    files: normalized,
    digest: createHash('sha256').update(JSON.stringify(normalized)).digest('hex'),
  }
}

function verifyDigestTree(root, manifest, options) {
  if (manifest?.schema !== SCHEMA || manifest.algorithm !== 'sha256' || typeof manifest.digest !== 'string' || manifest.files === null || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    throw new Error('Digest manifest is invalid')
  }
  const actual = digestTree(root, options)
  if (actual.digest !== manifest.digest || JSON.stringify(actual.files) !== JSON.stringify(manifest.files)) {
    throw new Error('Digest manifest does not match the installed tree')
  }
  return actual
}

function archiveEntry(path, entryName) {
  const archive = gunzipSync(readFileSync(path), { maxOutputLength: MAX_OPENCLAW_ARCHIVE_BYTES })
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/u, '')
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/u, '').trim()
    const size = Number.parseInt(sizeText || '0', 8)
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > archive.length) throw new Error('OpenClaw distribution tar entry is invalid')
    if (name === entryName) return archive.subarray(offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512
  }
  throw new Error('OpenClaw distribution does not contain the fixed entrypoint')
}

function validatedCandidate(home, candidate, { verifyArtifact = true, requireManifests = true } = {}) {
  const sha512 = validateOfficialRegistry(candidate)
  const resolved = candidatePaths(home, candidate)
  if (verifyArtifact) {
    let file
    try { file = lstatSync(resolved.artifactPath) } catch { throw new Error('OpenClaw distribution artifact is missing') }
    if (!file.isFile()) throw new Error('OpenClaw distribution artifact is not a file')
    if (hashFile(resolved.artifactPath) !== sha512) throw new Error('OpenClaw distribution sha512 does not match official metadata')
    if (![join(resolved.runtimePath, 'openclaw.mjs'), join(resolved.runtimePath, 'node_modules', 'openclaw', 'openclaw.mjs')].includes(resolved.entryPath)) throw new Error('OpenClaw entryPath must be the package entrypoint')
    const packagedEntry = archiveEntry(resolved.artifactPath, 'package/openclaw.mjs')
    if (!packagedEntry.equals(readFileSync(resolved.entryPath))) throw new Error('OpenClaw entrypoint does not match the verified distribution')
  }
  const installedManifest = requireManifests || candidate.installedManifest
    ? verifyDigestTree(resolved.runtimePath, candidate.installedManifest)
    : undefined
  const nodeManifest = requireManifests || candidate.nodeManifest
    ? verifyDigestTree(dirname(resolved.nodePath), candidate.nodeManifest, { excluded: new Set(['.phoenix-node.json']) })
    : undefined
  return {
    schema: SCHEMA,
    status: 'prepared',
    version: candidate.version,
    nodePath: resolved.nodePath,
    entryPath: resolved.entryPath,
    runtimePath: resolved.runtimePath,
    artifactPath: resolved.artifactPath,
    ...(installedManifest ? { installedManifest } : {}),
    ...(nodeManifest ? { nodeManifest } : {}),
    ...(validVersion(candidate.nodeVersion) ? { nodeVersion: candidate.nodeVersion } : {}),
    ...(candidate.nodePlatform === OFFICIAL_NODE_PLATFORM ? { nodePlatform: candidate.nodePlatform } : {}),
    ...(typeof candidate.nodeZipSha256 === 'string' && /^[a-f0-9]{64}$/iu.test(candidate.nodeZipSha256) ? { nodeZipSha256: candidate.nodeZipSha256.toLowerCase() } : {}),
    registry: {
      name: 'openclaw',
      version: candidate.version,
      repository: 'openclaw/openclaw',
      dist: { tarball: officialTarball(candidate.version), sha512 },
    },
  }
}

function launchSpec(home, value) {
  const runtimeRoot = pathsFor(home).root
  if (value?.schema !== SCHEMA || !validVersion(value.version)) throw new Error('OpenClaw active marker is invalid')
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error('OpenClaw active port is invalid')
  const verified = validatedCandidate(home, value)
  if (!existsSync(verified.entryPath) || !existsSync(verified.runtimePath)) throw new Error('OpenClaw active runtime is missing')
  if (!isWithin(runtimeRoot, verified.runtimePath) || !isWithin(verified.runtimePath, verified.entryPath)) throw new Error('OpenClaw active paths leave the isolated runtime')
  return verified
}

function scrubEnvironment(home, runtimeRoot, port, supplied) {
  const source = { ...process.env, ...(supplied ?? {}) }
  const environment = {}
  for (const [key, value] of Object.entries(source)) {
    if (!SAFE_ENVIRONMENT_KEYS.has(key) || SECRET_ENVIRONMENT_KEY.test(key) || typeof value !== 'string') continue
    environment[key] = value
  }
  environment.DSH_HOME = home
  environment.OPENCLAW_STATE_DIR = join(runtimeRoot, 'state')
  environment.OPENCLAW_CONFIG_PATH = join(runtimeRoot, 'openclaw.json')
  environment.OPENCLAW_GATEWAY_PORT = String(port)
  environment.OPENCLAW_GATEWAY_BIND = 'loopback'
  return environment
}

function safePort(port) {
  const value = port ?? DEFAULT_PORT
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new RangeError('OpenClaw gateway port must be an integer from 1 to 65535')
  return value
}

function executionIsBusy(execution) {
  if (execution?.live === true || execution?.uncertain === true) return true
  if (LIVE_PHASES.has(execution?.phase)) return true
  return Array.isArray(execution?.phases) && execution.phases.some((phase) => LIVE_PHASES.has(phase))
}

function busyResult() {
  return { status: 'deferred', code: 'PHOENIX_EXECUTIONS_BUSY' }
}

function lifecycleBusyResult() {
  return { status: 'blocked', code: 'OPENCLAW_LIFECYCLE_BUSY' }
}

function ownerProcessState(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return 'unknown'
  try {
    process.kill(pid, 0)
    return 'alive'
  } catch (error) {
    // ESRCH is the only evidence that permits stale-lock recovery. Access
    // errors, malformed PIDs, and platform-specific failures remain unknown.
    return error?.code === 'ESRCH' ? 'dead' : 'unknown'
  }
}

function lockPaths(runtimeRoot) {
  // The two legacy names are still inspected so an older manager cannot race
  // this one. New owners publish one canonical shared record.
  return [
    join(runtimeRoot, SHARED_LOCK_FILE),
    join(runtimeRoot, PREPARE_LOCK_FILE),
    join(runtimeRoot, LIFECYCLE_LOCK_FILE),
  ]
}

function inspectLock(path) {
  if (!existsSync(path)) return 'missing'
  const value = readJson(path)
  return ownerProcessState(value?.pid)
}

function runtimeLockBusyError() {
  return Object.assign(new Error('OpenClaw runtime lock owner is live or unknown'), { code: 'OPENCLAW_RUNTIME_BUSY' })
}

function acquireRecoveryGuard(runtimeRoot) {
  const guardPath = join(runtimeRoot, SHARED_LOCK_RECOVERY_FILE)
  const token = randomUUID()
  const record = { schema: SCHEMA, pid: process.pid, token, kind: 'recovery', startedAt: new Date().toISOString() }
  // A stale guard cannot be removed safely with a read/rename sequence:
  // another recoverer may replace it between those operations. Preserve it
  // for an exclusive offline repair instead of moving a live owner's guard.
  if (existsSync(guardPath)) throw runtimeLockBusyError()
  let handle
  try {
    handle = openSync(guardPath, 'wx')
    writeSync(handle, Buffer.from(`${JSON.stringify(record)}\n`, 'utf8'))
    closeSync(handle)
  } catch (error) {
    if (handle !== undefined) {
      try { closeSync(handle) } catch { /* close is best effort after a failed guard write */ }
      try { unlinkSync(guardPath) } catch { /* preserve a competing recovery guard */ }
    }
    if (error?.code === 'EEXIST') throw runtimeLockBusyError()
    throw error
  }
  let released = false
  return () => {
    if (released) return
    released = true
    const current = readJson(guardPath)
    if (current?.token !== token) return
    try { unlinkSync(guardPath) } catch { /* preserve a replacement recovery guard */ }
  }
}

function acquireSharedRuntimeLock(runtimeRoot, kind) {
  mkdirSync(runtimeRoot, { recursive: true })
  const token = randomUUID()
  const record = { schema: SCHEMA, pid: process.pid, token, kind, startedAt: new Date().toISOString() }
  const bytes = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8')
  const lockPath = join(runtimeRoot, SHARED_LOCK_FILE)
  const legacyPaths = lockPaths(runtimeRoot).slice(1)
  const claimFresh = path => {
    let handle
    try {
      handle = openSync(path, 'wx')
      writeSync(handle, bytes)
      closeSync(handle)
      return true
    } catch (error) {
      if (handle !== undefined) {
        try { closeSync(handle) } catch { /* close is best effort after a failed owner write */ }
        try { unlinkSync(path) } catch { /* preserve a competing owner */ }
      }
      if (error?.code === 'EEXIST') throw runtimeLockBusyError()
      throw error
    }
  }
  let releaseRecovery
  try {
    const recoveryPath = join(runtimeRoot, SHARED_LOCK_RECOVERY_FILE)
    for (const legacyPath of legacyPaths) {
      if (!existsSync(legacyPath)) continue
      const state = inspectLock(legacyPath)
      if (state === 'dead') {
        releaseRecovery ??= acquireRecoveryGuard(runtimeRoot)
        const reread = inspectLock(legacyPath)
        if (reread === 'dead') {
          try { unlinkSync(legacyPath) } catch { throw runtimeLockBusyError() }
        } else if (reread !== 'missing') {
          throw runtimeLockBusyError()
        }
        continue
      }
      throw runtimeLockBusyError()
    }
    if (existsSync(lockPath)) {
      const state = inspectLock(lockPath)
      if (state === 'dead') {
        releaseRecovery ??= acquireRecoveryGuard(runtimeRoot)
        const reread = inspectLock(lockPath)
        if (reread === 'dead') {
          try { unlinkSync(lockPath) } catch { throw runtimeLockBusyError() }
        } else if (reread !== 'missing') {
          throw runtimeLockBusyError()
        }
      } else {
        throw runtimeLockBusyError()
      }
    }
    // If recovery was needed, retain the guard through the canonical claim;
    // another manager cannot observe a missing lock and race the recovery.
    if (existsSync(recoveryPath) && releaseRecovery === undefined) throw runtimeLockBusyError()
    claimFresh(lockPath)
    // Publish both legacy fences only after the canonical shared lock is
    // owned. An older manager that wins either wx claim makes this operation
    // abort before it mutates the runtime. Each fence carries our token and
    // is removed only by our release closure.
    for (const legacyPath of legacyPaths) claimFresh(legacyPath)
  } catch (error) {
    releaseRecovery?.()
    for (const ownedPath of [lockPath, ...legacyPaths]) {
      const current = readJson(ownedPath)
      if (current?.token === token) {
        try { unlinkSync(ownedPath) } catch { /* cleanup is best effort */ }
      }
    }
    throw error
  }
  releaseRecovery?.()
  let released = false
  return () => {
    if (released) return
    released = true
    for (const ownedPath of [lockPath, ...legacyPaths]) {
      const current = readJson(ownedPath)
      if (current?.token === token) {
        try { unlinkSync(ownedPath) } catch { /* another cleanup already removed the lock */ }
      }
    }
  }
}

function acquireLifecycleFileLock(runtimeRoot) {
  try {
    return acquireSharedRuntimeLock(runtimeRoot, 'lifecycle')
  } catch (error) {
    if (error?.code === 'OPENCLAW_RUNTIME_BUSY') throw Object.assign(new Error('OpenClaw lifecycle is already owned by another process'), { code: 'OPENCLAW_LIFECYCLE_BUSY' })
    throw error
  }
}

async function withLifecycleLock(runtimeRoot, operation) {
  const previous = lifecycleTails.get(runtimeRoot) ?? Promise.resolve()
  let release
  const current = new Promise(resolveRelease => { release = resolveRelease })
  lifecycleTails.set(runtimeRoot, current)
  await previous
  let releaseFile
  try {
    try {
      releaseFile = acquireLifecycleFileLock(runtimeRoot)
    } catch (error) {
      if (error?.code === 'OPENCLAW_LIFECYCLE_BUSY') return lifecycleBusyResult()
      throw error
    }
    return await operation()
  } finally {
    releaseFile?.()
    release()
    if (lifecycleTails.get(runtimeRoot) === current) lifecycleTails.delete(runtimeRoot)
  }
}

function childExited(child) {
  return child && child.exitCode !== null && child.exitCode !== undefined
}

function appendBoundedOutput(state, chunk) {
  if (state.bytes >= MAX_PROCESS_OUTPUT_BYTES) return
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
  const remaining = MAX_PROCESS_OUTPUT_BYTES - state.bytes
  const clipped = bytes.subarray(0, remaining)
  state.value += clipped.toString('utf8')
  state.bytes += clipped.byteLength
}

function trustedWindowsPowerShell() {
  if (process.platform !== 'win32') return undefined
  const systemRoot = process.env.SystemRoot
  if (typeof systemRoot !== 'string' || !/^[A-Za-z]:[\\/][^\0]*$/u.test(systemRoot)) return undefined
  const executable = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(executable) ? executable : undefined
}

async function runWindowsPowerShellJson(script, timeoutMs) {
  const executable = trustedWindowsPowerShell()
  if (executable === undefined) return undefined
  return new Promise(resolveResult => {
    let helper
    let settled = false
    let timer
    const stdout = { value: '', bytes: 0 }
    const finish = value => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveResult(value)
    }
    try {
      helper = spawn(executable, [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
      ], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      finish(undefined)
      return
    }
    helper.stdout?.on('data', chunk => { appendBoundedOutput(stdout, chunk) })
    helper.once('error', () => { finish(undefined) })
    helper.once('close', code => {
      if (code !== 0) {
        finish(undefined)
        return
      }
      try { finish(stdout.value.trim() === '' ? [] : JSON.parse(stdout.value)) } catch { finish(undefined) }
    })
    timer = setTimeout(() => {
      try { helper.kill() } catch { /* the helper is owned by this manager */ }
      finish(undefined)
    }, Math.max(1, timeoutMs))
  })
}

function processRows(value) {
  const rows = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]
  return rows
    .map(row => ({ pid: Number(row?.ProcessId), parentPid: Number(row?.ParentProcessId) }))
    .filter(row => Number.isInteger(row.pid) && row.pid > 0 && Number.isInteger(row.parentPid) && row.parentPid > 0)
}

async function captureWindowsDescendantPids(pid, timeoutMs) {
  if (process.platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) return []
  const value = await runWindowsPowerShellJson(
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress',
    timeoutMs,
  )
  if (value === undefined) return undefined
  const parents = new Map(processRows(value).map(row => [row.pid, row.parentPid]))
  const descendants = []
  for (const candidate of parents.keys()) {
    let current = candidate
    const seen = new Set()
    while (!seen.has(current)) {
      seen.add(current)
      const parent = parents.get(current)
      if (parent === pid) {
        descendants.push(candidate)
        break
      }
      if (!Number.isInteger(parent) || parent <= 0) break
      current = parent
    }
  }
  return [...new Set(descendants)]
}

async function windowsPortOwners(port, timeoutMs) {
  if (process.platform !== 'win32') return []
  const value = await runWindowsPowerShellJson(
    `Get-NetTCPConnection -LocalPort ${String(port)} -State Listen | Select-Object OwningProcess,LocalPort,State | ConvertTo-Json -Compress`,
    timeoutMs,
  )
  if (value === undefined) return undefined
  return (Array.isArray(value) ? value : value === null ? [] : [value])
    .map(row => Number(row?.OwningProcess))
    .filter(pid => Number.isInteger(pid) && pid > 0)
}

async function verifyWindowsGatewayOwnership(child, port, timeoutMs) {
  if (process.platform !== 'win32') return true
  if (!Number.isInteger(child?.pid) || child.pid <= 0) return false
  const owners = await windowsPortOwners(port, timeoutMs)
  if (owners === undefined) return false
  if (owners.includes(child.pid)) return true
  const descendants = await captureWindowsDescendantPids(child.pid, timeoutMs)
  if (descendants === undefined) return false
  return descendants.some(pid => owners.includes(pid))
}

async function authenticatedGatewayHealth(options, port, timeoutMs) {
  const configPath = options?.env?.OPENCLAW_CONFIG_PATH
  if (typeof configPath !== 'string' || !isAbsolute(configPath)) return false
  let config
  try {
    const stat = lstatSync(configPath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_METADATA_BYTES) return false
    config = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    return false
  }
  const auth = config?.gateway?.auth
  const token = typeof auth?.token === 'string' && auth.token.length > 0 ? auth.token : undefined
  const password = typeof auth?.password === 'string' && auth.password.length > 0 ? auth.password : undefined
  if (token === undefined && password === undefined) return false
  let client
  try {
    const module = await import(OPENCLAW_CLIENT_MODULE.href)
    const Client = module.OpenClawGatewayClient
    if (typeof Client !== 'function') return false
    client = new Client({
      url: `ws://127.0.0.1:${String(port)}`,
      credentials: { ...(token === undefined ? {} : { token }), ...(password === undefined ? {} : { password }) },
      client: { id: 'gateway-client', mode: 'backend' },
      scopes: ['operator.read', 'operator.write'],
      timeoutMs: Math.max(1, Math.min(timeoutMs, 5000)),
    })
    const capabilities = await client.capabilities()
    if (!Array.isArray(capabilities?.scopes)
      || !capabilities.scopes.includes('operator.read')
      || !capabilities.scopes.includes('operator.write')) return false
    await client.health()
    return true
  } catch {
    return false
  } finally {
    try { await client?.dispose() } catch { /* authentication cleanup is best effort */ }
  }
}

async function defaultHealth(_command, _args, options, timeoutMs) {
  // Official readiness is an HTTP admission check. Starting another CLI for
  // every probe repeats its expensive cold imports and competes with startup.
  const port = safePort(Number(options.env.OPENCLAW_GATEWAY_PORT))
  const response = await fetch(`http://127.0.0.1:${port}/readyz`, {
    redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, 2000))),
  })
  if (!response.ok) {
    await response.body?.cancel()
    return { exitCode: 1, stdout: '', stderr: '' }
  }
  const reader = response.body?.getReader()
  if (reader === undefined) return { exitCode: 1, stdout: '', stderr: '' }
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > MAX_PROCESS_OUTPUT_BYTES) {
        await reader.cancel()
        return { exitCode: 1, stdout: '', stderr: '' }
      }
      chunks.push(Buffer.from(next.value))
    }
  } finally { reader.releaseLock() }
  if (!await authenticatedGatewayHealth(options, port, timeoutMs)) return { exitCode: 1, stdout: '', stderr: '' }
  return { exitCode: 0, stdout: Buffer.concat(chunks).toString('utf8'), stderr: '' }
}

async function killWindowsProcessTree(pid, timeoutMs = 5000, spawnImpl = spawn) {
  if (process.platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) return true
  return new Promise(resolveKill => {
    let settled = false
    let timer
    const finish = value => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveKill(value)
    }
    let killer
    try {
      killer = spawnImpl('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore'],
      })
    } catch {
      finish(false)
      return
    }
    // taskkill can fail before close on Windows. Always consume the async
    // spawn error so it cannot become an uncaught EventEmitter exception.
    killer.once('error', () => { finish(false) })
    killer.once('close', code => { finish(code === 0) })
    timer = setTimeout(() => {
      finish(false)
      try { killer.kill() } catch { /* Only this manager-owned helper is terminated. */ }
    }, Math.max(1, Math.min(timeoutMs, 5000)))
  })
}

/**
 * Exercise the bounded Windows termination helper without launching native processes.
 * @param {number} pid - Owned process id used in the helper arguments.
 * @param {number} timeoutMs - Maximum helper wait.
 * @param {Function} spawnImpl - Test-owned subprocess factory.
 * @returns {Promise<boolean>} False on timeout or uncertain termination.
 */
export function killWindowsProcessTreeForDiagnostics(pid, timeoutMs, spawnImpl) {
  return killWindowsProcessTree(pid, timeoutMs, spawnImpl)
}

async function terminateChildTree(child, timeoutMs) {
  if (!child) return false
  if (process.platform === 'win32' && Number.isInteger(child.pid) && child.pid > 0) {
    const treeKilled = await killWindowsProcessTree(child.pid, timeoutMs)
    if (!treeKilled) {
      // Keep the child handle owned by this manager, but do not claim the
      // descendants are gone when taskkill could not run.
      try { child.kill() } catch { /* child may have exited */ }
      return false
    }
    return true
  }
  try { child.kill() } catch { /* child may have exited */ }
  return true
}

function defaultRun(command, args, options, timeoutMs = DEFAULT_PROCESS_TIMEOUT_MS) {
  return new Promise((resolveRun, rejectRun) => {
    let child
    try {
      child = spawn(command, args, options)
    } catch (error) {
      rejectRun(error)
      return
    }
    const stdout = { value: '', bytes: 0 }
    const stderr = { value: '', bytes: 0 }
    let settled = false
    let quiescing = false
    let timer
    const treeBudget = 15000
    const initialTreeSnapshot = process.platform === 'win32'
      ? captureWindowsDescendantPids(child?.pid, treeBudget)
      : Promise.resolve([])
    const finish = (result, error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const output = { ...result, stdout: stdout.value, stderr: stderr.value }
      if (error) rejectRun(error)
      else resolveRun(output)
    }
    const settleAfterTreeExit = async (result, error) => {
      if (settled || quiescing) return
      quiescing = true
      const treeKilled = await terminateChildTree(child, treeBudget)
      // Do not release the preparation/lifecycle lock while the owned child
      // is still alive. On Windows taskkill /T /F is followed by the child
      // handle's close event, which is the manager's quiescence proof. The
      // wait is bounded; an uncertain tree is returned to the caller so its
      // durable lock can remain held instead of hanging this process forever.
      const waitBudget = Math.max(1, Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_PROCESS_TIMEOUT_MS)
      const exited = await waitForChildExit(child, waitBudget)
      const initial = await initialTreeSnapshot
      const after = process.platform === 'win32' ? await captureWindowsDescendantPids(child?.pid, treeBudget) : []
      const observedDead = Array.isArray(initial) && Array.isArray(after)
        && [...new Set([...initial, ...after])].every(pid => ownerProcessState(pid) === 'dead')
      const quiescent = treeKilled && exited && observedDead
      const status = { ...result, quiescent, ownedPid: child?.pid, treeStatus: quiescent ? 'quiescent' : 'uncertain' }
      if (error && !quiescent) Object.assign(error, { code: 'OPENCLAW_PROCESS_TREE_UNCERTAIN', ownedPid: child?.pid, treeStatus: 'uncertain' })
      finish(status, error)
    }
    timer = setTimeout(() => {
      void settleAfterTreeExit({ exitCode: null })
    }, Math.max(1, Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_PROCESS_TIMEOUT_MS))
    child.stdout?.on('data', chunk => { appendBoundedOutput(stdout, chunk) })
    child.stderr?.on('data', chunk => { appendBoundedOutput(stderr, chunk) })
    // An asynchronous spawn error must follow the same owned-child cleanup
    // path as a timeout before the caller is allowed to release its lock.
    child.once?.('error', error => { void settleAfterTreeExit({}, error) })
    child.once?.('close', code => {
      if (quiescing) return
      if (process.platform !== 'win32') {
        finish({ exitCode: code })
        return
      }
      // A natural Windows close does not prove that descendants are gone.
      // Capture the process tree after close; an unavailable snapshot remains
      // uncertain so callers keep their durable lock instead of reusing it.
      quiescing = true
      void Promise.all([initialTreeSnapshot, captureWindowsDescendantPids(child?.pid, treeBudget)]).then(([initial, afterClose]) => {
        const known = Array.isArray(initial) && Array.isArray(afterClose)
        const descendants = known ? [...new Set([...initial, ...afterClose])].filter(pid => ownerProcessState(pid) !== 'dead') : undefined
        const quiescent = known && descendants.length === 0
        finish({ exitCode: code, quiescent, ownedPid: child?.pid, treeStatus: quiescent ? 'quiescent' : 'uncertain', ...(descendants?.length ? { descendantPids: descendants } : {}) })
      })
    })
  })
}

/**
 * Run one owned process through the manager's bounded timeout and tree
 * quiescence path. This narrow diagnostic seam is used by native Windows
 * lifecycle tests; callers should use the public preparation APIs instead.
 * @param {string} command - Executable to run.
 * @param {string[]} args - Child arguments.
 * @param {object} options - `spawn` options for the owned child.
 * @param {number} [timeoutMs] - Bounded process and quiescence budget.
 * @returns {Promise<object>} Bounded process result with tree status.
 */
export function runDefaultProcessForDiagnostics(command, args, options, timeoutMs = DEFAULT_PROCESS_TIMEOUT_MS) {
  return defaultRun(command, args, options, timeoutMs)
}

/**
 * Stop one manager-owned process tree and return only after bounded tree
 * quiescence has been proven. This seam is restricted to native lifecycle
 * tests; public lifecycle calls use it through the default runner.
 */
export function stopDefaultProcessTreeForDiagnostics(child, timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS) {
  return defaultStopChild(child, timeoutMs)
}

function defaultRunner() {
  return {
    spawn(command, args, options) { return spawn(command, args, options) },
    run(command, args, options, timeoutMs) { return defaultRun(command, args, options, timeoutMs) },
    health(command, args, options, timeoutMs) { return defaultHealth(command, args, options, timeoutMs) },
    verifyGatewayOwnership(child, port, timeoutMs) { return verifyWindowsGatewayOwnership(child, port, timeoutMs) },
    stopChild(child, timeoutMs) { return defaultStopChild(child, timeoutMs) },
    sleep(ms) { return new Promise((resolveSleep) => setTimeout(resolveSleep, ms)) },
    kill(pid) { process.kill(pid) },
    waitForExit(child, timeoutMs) { return waitForChildExit(child, timeoutMs) },
  }
}

function runnerFor(runner) {
  const custom = runner ?? {}
  const effective = { ...defaultRunner(), ...custom }
  // Injectable test runners do not represent real OS ownership. Keep the
  // production default verifier unless the caller supplied a runner seam.
  if (runner !== undefined && custom.verifyGatewayOwnership === undefined) delete effective.verifyGatewayOwnership
  if (runner !== undefined && custom.stopChild === undefined) delete effective.stopChild
  return effective
}

async function waitForChildExit(child, timeoutMs) {
  if (childExited(child)) return true
  return new Promise((resolveWait) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveWait(childExited(child))
    }
    const timer = setTimeout(finish, timeoutMs)
    child.once?.('exit', finish)
    child.once?.('close', finish)
    if (childExited(child)) finish()
  })
}

function healthPayloadIsReady(parsed) {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false
  if (parsed.ok === false) return false
  if (parsed.ok === true) return true
  return ['ok', 'ready', 'healthy'].includes(parsed.status)
}

async function boundedCall(call, timeoutMs) {
  const duration = Math.max(1, Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_PROCESS_TIMEOUT_MS)
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(call),
      new Promise(resolve => { timer = setTimeout(() => resolve(BOUNDED_TIMEOUT), duration) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function healthCheck(home, spec, child, runner, port, timeoutMs, intervalMs, suppliedEnv) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    if (childExited(child)) return false
    try {
      const remaining = Math.max(1, deadline - Date.now())
      const result = await boundedCall(() => runner.health(spec.nodePath, [spec.entryPath, 'health', '--json', '--timeout', String(timeoutMs)], {
        cwd: spec.runtimePath,
        env: scrubEnvironment(home, join(home, RUNTIME_DIRECTORY), port, suppliedEnv),
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }, remaining), remaining)
      if (result?.exitCode === 0 && typeof result.stdout === 'string') {
        const parsed = JSON.parse(result.stdout)
      if (healthPayloadIsReady(parsed) && !childExited(child)) {
        const ownershipBudget = Math.max(1, deadline - Date.now())
        if (typeof runner.verifyGatewayOwnership !== 'function' || await runner.verifyGatewayOwnership(child, port, ownershipBudget)) return true
      }
      }
    } catch { /* retry until the bounded official health command budget expires */ }
    if (Date.now() >= deadline) break
    await boundedCall(() => runner.sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now()))), Math.max(1, deadline - Date.now()))
  }
  return false
}

async function launchGateway(home, spec, options = {}) {
  const runner = runnerFor(options.runner)
  const port = safePort(options.port)
  const args = [spec.entryPath, 'gateway', 'run', '--bind', 'loopback', '--port', String(port)]
  let child
  try {
    mkdirSync(join(home, RUNTIME_DIRECTORY, 'state'), { recursive: true })
    child = await runner.spawn(spec.nodePath, args, {
      cwd: spec.runtimePath,
      env: scrubEnvironment(home, join(home, RUNTIME_DIRECTORY), port, options.env),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    if (child === null || typeof child !== 'object' || !Number.isInteger(child.pid) || child.pid <= 0) throw new Error('OpenClaw gateway spawn returned no owned child handle')
    const spawnErrors = []
    // Custom runners may return an EventEmitter and report CreateProcess
    // failures on the next turn. Install the listener before the first health
    // probe so that an async spawn failure cannot escape as an uncaught error.
    child?.once?.('error', error => { spawnErrors.push(error) })
    const ready = await healthCheck(
      home,
      spec,
      child,
      runner,
      port,
      options.healthTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      options.healthIntervalMs ?? DEFAULT_HEALTH_INTERVAL_MS,
      options.env,
    )
    if (spawnErrors.length > 0) throw spawnErrors[0]
    if (!ready) {
      const stopped = child?.pid ? await stopChild(child, runner, options.stopTimeoutMs) : true
      return { status: 'blocked', code: stopped ? 'HEALTH_CHECK_FAILED' : 'HEALTH_CHECK_FAILED_ORPHAN' }
    }
    return { status: 'ready', child, runner, port, endpoint: `http://127.0.0.1:${port}` }
  } catch {
    const stopped = child?.pid ? await stopChild(child, runner, options.stopTimeoutMs) : true
    return { status: 'blocked', code: stopped ? 'GATEWAY_START_FAILED' : 'GATEWAY_START_FAILED_ORPHAN' }
  }
}

async function stopChild(child, runner, timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS) {
  if (!child) return true
  if (typeof runner?.stopChild === 'function') {
    try { return await runner.stopChild(child, timeoutMs) } catch { return false }
  }
  try {
    if (typeof child.kill === 'function') await child.kill()
    else if (child.pid) await runner.kill(child.pid)
    const boundedTimeout = Math.max(1, Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_HEALTH_TIMEOUT_MS)
    const exited = await boundedCall(() => runner.waitForExit(child, boundedTimeout), boundedTimeout)
    return exited === false || exited === BOUNDED_TIMEOUT ? false : true
  } catch {
    return childExited(child)
  }
}

async function defaultStopChild(child, timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS) {
  if (!child) return true
  const boundedTimeout = Math.max(1, Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_HEALTH_TIMEOUT_MS)
  const treeBudget = Math.max(1, Math.min(boundedTimeout, 5000))
  const initialTree = process.platform === 'win32'
    ? await captureWindowsDescendantPids(child.pid, treeBudget)
    : []
  const treeKilled = await terminateChildTree(child, treeBudget)
  const exited = await waitForChildExit(child, boundedTimeout)
  if (!treeKilled || !exited) return false
  if (process.platform !== 'win32') return true
  // The initial snapshot proves that any descendants present before the kill
  // belonged to the owned tree. A second bounded snapshot must be available
  // and empty before the lifecycle marker may be released.
  const afterTree = await captureWindowsDescendantPids(child.pid, treeBudget)
  return Array.isArray(initialTree) && Array.isArray(afterTree)
    && [...new Set([...initialTree, ...afterTree])].every(pid => ownerProcessState(pid) === 'dead')
}

function activeMarker(spec, launch, status = 'active') {
  return {
    schema: SCHEMA,
    status,
    version: spec.version,
    nodePath: spec.nodePath,
    entryPath: spec.entryPath,
    runtimePath: spec.runtimePath,
    artifactPath: spec.artifactPath,
    ...(spec.installedManifest ? { installedManifest: spec.installedManifest } : {}),
    ...(spec.nodeManifest ? { nodeManifest: spec.nodeManifest } : {}),
    ...(spec.nodeVersion ? { nodeVersion: spec.nodeVersion } : {}),
    ...(spec.nodePlatform ? { nodePlatform: spec.nodePlatform } : {}),
    ...(spec.nodeZipSha256 ? { nodeZipSha256: spec.nodeZipSha256 } : {}),
    registry: spec.registry,
    port: launch.port,
    endpoint: launch.endpoint,
    ...(launch.child?.pid ? { pid: launch.child.pid } : {}),
    ...(status === 'active' ? { activatedAt: new Date().toISOString() } : { stoppedAt: new Date().toISOString() }),
  }
}

function markerWithNoPid(marker) {
  if (!marker || typeof marker !== 'object') return marker
  const copy = { ...marker }
  delete copy.pid
  return copy
}

function restoreMarker(path, value) {
  if (value === undefined) {
    try { unlinkSync(path) } catch { /* the marker was already absent */ }
    return
  }
  writeJsonAtomic(path, value)
}

function liveOwnedGateway(paths) {
  const existing = runningGateways.get(paths.root)
  if (existing?.child && !childExited(existing.child)) return existing
  if (existing) runningGateways.delete(paths.root)
  return undefined
}

function persistedOwnerIsUnknown(active) {
  return Number.isInteger(active?.pid) && active.pid > 0
}

async function quiesceCurrentGateway({ paths, active, runner, stopTimeoutMs } = {}) {
  const existing = liveOwnedGateway(paths)
  if (!existing) {
    if (persistedOwnerIsUnknown(active)) return { status: 'blocked', code: 'OPENCLAW_GATEWAY_OWNER_UNKNOWN' }
    return { status: 'stopped' }
  }
  const effectiveRunner = existing.runner ?? runnerFor(runner)
  if (!await stopChild(existing.child, effectiveRunner, stopTimeoutMs)) {
    return { status: 'blocked', code: 'GATEWAY_STOP_TIMEOUT' }
  }
  runningGateways.delete(paths.root)
  return { status: 'stopped', existing }
}

async function restoreOwnedGateway({ home, paths, spec, previousMarker, previousPrevious, runner, healthTimeoutMs, healthIntervalMs, stopTimeoutMs } = {}) {
  if (!spec) {
    try {
      restoreMarker(paths.active, previousMarker)
      restoreMarker(paths.previous, previousPrevious)
      return { status: 'restored' }
    } catch {
      return { status: 'blocked', code: 'GATEWAY_STATE_RESTORE_FAILED' }
    }
  }
  const launch = await launchGateway(home, spec, {
    runner,
    port: previousMarker?.port,
    healthTimeoutMs,
    healthIntervalMs,
    stopTimeoutMs,
  })
  if (launch.status !== 'ready') return { status: 'blocked', code: 'GATEWAY_RESTORE_HEALTH_FAILED' }
  const restored = activeMarker(spec, launch)
  try {
    restoreMarker(paths.previous, previousPrevious)
    restoreMarker(paths.active, restored)
  } catch {
    const stopped = await stopChild(launch.child, launch.runner, stopTimeoutMs)
    return { status: 'blocked', code: stopped ? 'GATEWAY_STATE_RESTORE_FAILED' : 'GATEWAY_STATE_RESTORE_FAILED_ORPHAN' }
  }
  runningGateways.set(paths.root, { child: launch.child, runner: launch.runner, port: launch.port })
  return { status: 'restored', version: restored.version, port: restored.port }
}

async function replaceGateway({ home, paths, target, activeBefore, previousBefore, runner, port, env, healthTimeoutMs, healthIntervalMs, stopTimeoutMs, resultStatus } = {}) {
  let oldSpec
  const oldOwned = liveOwnedGateway(paths)
  if (oldOwned) {
    try { oldSpec = launchSpec(home, activeBefore) } catch { return { status: 'blocked', code: 'ACTIVE_INVALID' } }
  }
  const quiesced = await quiesceCurrentGateway({ paths, active: activeBefore, runner, stopTimeoutMs })
  if (quiesced.status !== 'stopped') return quiesced

  const launch = await launchGateway(home, target, { runner, port, env, healthTimeoutMs, healthIntervalMs, stopTimeoutMs })
  if (launch.status !== 'ready') {
    if (oldSpec) {
      const restored = await restoreOwnedGateway({ home, paths, spec: oldSpec, previousMarker: activeBefore, previousPrevious: previousBefore, runner: oldOwned.runner, healthTimeoutMs, healthIntervalMs, stopTimeoutMs })
      if (restored.status !== 'restored') return restored
    }
    return launch
  }
  const active = activeMarker(target, launch)
  try {
    writeJsonAtomic(paths.previous, activeBefore?.schema === SCHEMA ? activeBefore : { schema: SCHEMA, status: 'none' })
    writeJsonAtomic(paths.active, active)
  } catch {
    const stopped = await stopChild(launch.child, launch.runner, stopTimeoutMs)
    const restored = await restoreOwnedGateway({ home, paths, spec: oldSpec, previousMarker: activeBefore, previousPrevious: previousBefore, runner: oldOwned?.runner ?? runner, healthTimeoutMs, healthIntervalMs, stopTimeoutMs })
    if (restored.status !== 'restored') return { status: 'blocked', code: stopped ? restored.code : 'ACTIVE_MARKER_WRITE_FAILED_ORPHAN' }
    return { status: 'blocked', code: stopped ? 'ACTIVE_MARKER_WRITE_FAILED' : 'ACTIVE_MARKER_WRITE_FAILED_ORPHAN' }
  }
  runningGateways.set(paths.root, { child: launch.child, runner: launch.runner, port: launch.port })
  return { status: resultStatus, version: active.version, port: active.port }
}

function markerForInspection(marker) {
  if (marker?.schema !== SCHEMA || typeof marker.status !== 'string' || !INSPECTABLE_STATUSES.has(marker.status)) return undefined
  const result = { schema: SCHEMA, status: marker.status }
  for (const key of ['version', 'target', 'port', 'endpoint']) {
    if (key === 'version' && !validVersion(marker[key])) continue
    if (key === 'target' && !/^[a-f0-9]{40}$/iu.test(marker[key] ?? '')) continue
    if (key === 'port' && (!Number.isInteger(marker[key]) || marker[key] < 1 || marker[key] > 65535)) continue
    if (key === 'endpoint' && (typeof marker[key] !== 'string' || !/^http:\/\/127\.0\.0\.1:\d+$/u.test(marker[key]))) continue
    if (typeof marker[key] === 'string' || Number.isInteger(marker[key])) result[key] = marker[key]
  }
  return result
}

function readPhoenixState(controlDirectory, fallbackDirectory) {
  const marker = readJson(join(controlDirectory, PHOENIX_ACTIVE_RUNTIME)) ?? readJson(join(fallbackDirectory ?? controlDirectory, PHOENIX_ACTIVE_RUNTIME))
  const update = readJson(join(controlDirectory, PHOENIX_UPDATE_STATE)) ?? readJson(join(fallbackDirectory ?? controlDirectory, PHOENIX_UPDATE_STATE))
  const managed = existsSync(join(controlDirectory, PHOENIX_MARKER)) || existsSync(join(fallbackDirectory ?? controlDirectory, PHOENIX_MARKER))
  const activePath = typeof marker?.path === 'string' ? resolve(marker.path) : undefined
  const active = marker?.schema === SCHEMA && /^[a-f0-9]{40}$/iu.test(marker.target ?? '') && activePath && existsSync(activePath)
    ? { schema: SCHEMA, target: marker.target, path: activePath }
    : undefined
  return {
    marker: managed,
    activeRuntime: active,
    updateState: markerForInspection(update),
  }
}

function readCodexState(home) {
  const runtimeRoot = join(home, CODEX_RUNTIME_DIRECTORY)
  const marker = readJson(join(runtimeRoot, CODEX_ACTIVE_FILE))
  if (marker?.schema !== SCHEMA || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(marker.version ?? '') || typeof marker.bin !== 'string') return undefined
  const bin = resolve(runtimeRoot, marker.bin)
  if (!isWithin(runtimeRoot, bin) || !existsSync(bin)) return undefined
  return { version: marker.version, bin }
}

function officialNodeArchive(version, platform = OFFICIAL_NODE_PLATFORM) {
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new TypeError('OpenClaw Node version must be pinned')
  if (platform !== OFFICIAL_NODE_PLATFORM) throw new Error('OpenClaw preparation currently supports only the official Windows x64 Node archive')
  const filename = `node-v${version}-${platform}.zip`
  return {
    filename,
    url: `https://nodejs.org/dist/v${version}/${filename}`,
    shasums: `https://nodejs.org/dist/v${version}/SHASUMS256.txt`,
  }
}

function sha512IntegrityHex(integrity) {
  if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) throw new Error('OpenClaw registry sha512 integrity is required')
  const digest = Buffer.from(integrity.slice('sha512-'.length), 'base64')
  if (digest.length !== 64) throw new Error('OpenClaw registry sha512 integrity is invalid')
  return digest.toString('hex')
}

function officialRepository(value) {
  const raw = typeof value === 'string' ? value : value?.url
  if (typeof raw !== 'string') return false
  const normalized = raw.replace(/^git\+/u, '').replace(/\.git$/u, '')
  return normalized === 'https://github.com/openclaw/openclaw'
}

async function responseBytes(url, { fetchImpl = globalThis.fetch, maxBytes, timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('OpenClaw preparation requires fetch')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: controller.signal })
    if (!response?.ok || response.status < 200 || response.status >= 300) throw new Error(`OpenClaw download failed with HTTP ${String(response?.status ?? 'unknown')}`)
    const declared = response.headers?.get?.('content-length')
    if (declared !== undefined && declared !== null && Number.isSafeInteger(Number(declared)) && Number(declared) > maxBytes) {
      throw new Error('OpenClaw download exceeds the bounded size limit')
    }
    let bytes
    if (response.body?.getReader) {
      const reader = response.body.getReader()
      const chunks = []
      let total = 0
      try {
        while (true) {
          const part = await reader.read()
          if (part.done) break
          const chunk = Buffer.from(part.value)
          total += chunk.byteLength
          if (total > maxBytes) throw new Error('OpenClaw download exceeds the bounded size limit')
          chunks.push(chunk)
        }
      } finally {
        try { await reader.releaseLock() } catch { /* stream is already settled */ }
      }
      bytes = Buffer.concat(chunks, total)
    } else if (typeof response.arrayBuffer === 'function') {
      bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.byteLength > maxBytes) throw new Error('OpenClaw download exceeds the bounded size limit')
    } else {
      throw new Error('OpenClaw download response has no readable body')
    }
    return bytes
  } finally {
    clearTimeout(timeout)
  }
}

function writeDownload(path, bytes) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.download`
  try {
    writeFileSync(temporary, bytes, { flag: 'wx' })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function acquirePreparationLock(runtimeRoot) {
  try {
    return acquireSharedRuntimeLock(runtimeRoot, 'preparation')
  } catch (error) {
    if (error?.code === 'OPENCLAW_RUNTIME_BUSY') throw new Error('OpenClaw preparation is already in progress')
    throw error
  }
}

function processTreeIsUncertain(result) {
  return result?.quiescent === false || result?.treeStatus === 'uncertain'
}

function processTreeUncertainError(operation, resultOrError) {
  const pid = Number.isInteger(resultOrError?.ownedPid)
    ? resultOrError.ownedPid
    : Number.isInteger(resultOrError?.pid) ? resultOrError.pid : undefined
  return Object.assign(new Error(`${operation} left an owned process tree without a quiescence proof`), {
    code: 'OPENCLAW_PROCESS_TREE_UNCERTAIN',
    operation,
    pid,
    treeStatus: 'uncertain',
    cause: resultOrError,
  })
}

function writeRuntimeBlocked(runtimeRoot, operation, resultOrError) {
  const pid = Number.isInteger(resultOrError?.ownedPid)
    ? resultOrError.ownedPid
    : Number.isInteger(resultOrError?.pid) ? resultOrError.pid : undefined
  const marker = {
    schema: SCHEMA,
    status: 'blocked',
    code: 'OPENCLAW_PROCESS_TREE_UNCERTAIN',
    operation,
    ...(pid === undefined ? {} : { pid, pidIdentity: { pid, observedAt: new Date().toISOString() } }),
    treeStatus: 'uncertain',
    blockedAt: new Date().toISOString(),
  }
  writeJsonAtomic(join(runtimeRoot, RUNTIME_BLOCKED_FILE), marker)
  return marker
}

function runtimeBlockedResult(runtimeRoot) {
  const marker = readJson(join(runtimeRoot, RUNTIME_BLOCKED_FILE))
  if (marker?.status !== 'blocked') return undefined
  return {
    status: 'blocked',
    code: marker.code ?? 'OPENCLAW_RUNTIME_BLOCKED',
    ...(Number.isInteger(marker.pid) ? { pid: marker.pid } : {}),
    ...(typeof marker.operation === 'string' ? { operation: marker.operation } : {}),
  }
}

function retentionReceipt(home, { installerBusy = false, apply = false, confirm = false } = {}) {
  try {
    const plan = planOpenClawRuntimeRetention({ home, runtimeLockHeld: true, installerBusy })
    if (apply === true && confirm === true) {
      const applied = executeOpenClawRuntimeRetention(plan, { confirm: true, dryRun: false, runtimeLockHeld: true })
      return {
        status: applied.status,
        dryRun: false,
        runtimeLockHeld: true,
        targetCount: plan.targets.length,
        retainedCount: plan.retained.length,
        skippedCount: (applied.skipped ?? plan.skipped).length,
        issueCount: applied.issues.length,
        removedCount: applied.removed.length,
      }
    }
    return {
      status: plan.status,
      dryRun: true,
      runtimeLockHeld: true,
      targetCount: plan.targets.length,
      retainedCount: plan.retained.length,
      skippedCount: plan.skipped.length,
      issueCount: plan.issues.length,
    }
  } catch {
    return {
      status: 'blocked',
      dryRun: true,
      runtimeLockHeld: true,
      targetCount: 0,
      retainedCount: 0,
      skippedCount: 0,
      issueCount: 1,
    }
  }
}

async function fetchOfficialRegistryMetadata(version, fetchImpl) {
  if (!validVersion(version)) throw new TypeError('OpenClaw version must be pinned')
  const bytes = await responseBytes(`${OFFICIAL_OPENCLAW_REGISTRY}/openclaw/${version}`, {
    fetchImpl,
    maxBytes: MAX_METADATA_BYTES,
  })
  let metadata
  try { metadata = JSON.parse(bytes.toString('utf8')) } catch { throw new Error('OpenClaw registry metadata is invalid JSON') }
  if (metadata?.name !== 'openclaw' || metadata.version !== version || !officialRepository(metadata.repository)) {
    throw new Error('OpenClaw registry metadata is not the official pinned package')
  }
  const tarball = officialTarball(version)
  if (metadata.dist?.tarball !== tarball) throw new Error('OpenClaw registry tarball URL is not the official pinned URL')
  const candidate = {
    version,
    registry: {
      name: 'openclaw',
      version,
      repository: OFFICIAL_OPENCLAW_REPOSITORY,
      dist: { tarball, sha512: sha512IntegrityHex(metadata.dist.integrity) },
    },
  }
  validateOfficialRegistry(candidate)
  return candidate.registry
}

function nodeRuntimePaths(runtimeRoot, version, platform = OFFICIAL_NODE_PLATFORM) {
  const archive = officialNodeArchive(version, platform)
  const nodeRoot = join(runtimeRoot, 'node', `node-v${version}-${platform}`)
  return {
    ...archive,
    nodeRoot,
    nodePath: join(nodeRoot, 'node.exe'),
    npmPath: join(nodeRoot, 'npm.cmd'),
    archivePath: join(runtimeRoot, 'artifacts', archive.filename),
    markerPath: join(nodeRoot, '.phoenix-node.json'),
  }
}

function nodeSha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function nodeChecksum(shasums, filename) {
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = shasums.match(new RegExp(`^([a-f0-9]{64})\\s+\\*?${escaped}\\s*$`, 'imu'))
  if (!match?.[1]) throw new Error('Official Node SHASUMS256.txt has no checksum for the pinned archive')
  return match[1].toLowerCase()
}

function scanExtractedTree(root, current = root) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const target = resolve(current, entry.name)
    if (!isWithin(root, target)) throw new Error('Official Node archive extracted outside its isolated directory')
    const info = lstatSync(target)
    if (info.isSymbolicLink()) throw new Error('Official Node archive contains an unsafe symbolic link')
    if (entry.isDirectory()) scanExtractedTree(root, target)
  }
}

async function runNodeVersion(node, home, runtimeRoot, runner, timeoutMs) {
  const result = await runner.run(node.nodePath, ['--version'], {
    cwd: node.nodeRoot,
    env: scrubEnvironment(home, runtimeRoot, DEFAULT_PORT),
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }, timeoutMs)
  if (processTreeIsUncertain(result)) throw processTreeUncertainError('node-version', result)
  return result?.exitCode === 0 && String(result.stdout ?? '').trim() === `v${node.version}`
}

async function prepareNodeRuntime({ home, runtimeRoot, version, fetchImpl, runner, timeoutMs = DEFAULT_PROCESS_TIMEOUT_MS }) {
  if (process.platform !== 'win32') throw new Error('OpenClaw isolated Node preparation requires Windows x64')
  assertSafeDirectoryPath(runtimeRoot)
  const node = { ...nodeRuntimePaths(runtimeRoot, version), version }
  const stored = readJson(node.markerPath)
  let storedManifestValid = false
  if (stored?.manifest?.schema === SCHEMA) {
    try {
      verifyDigestTree(node.nodeRoot, stored.manifest, { excluded: new Set(['.phoenix-node.json']) })
      storedManifestValid = true
    } catch { /* force a fresh official archive after any tree drift */ }
  }
  if (stored?.version === version && stored.platform === OFFICIAL_NODE_PLATFORM
    && typeof stored.sha256 === 'string' && storedManifestValid && existsSync(node.nodePath) && existsSync(node.npmPath)
    && await runNodeVersion(node, home, runtimeRoot, runner, timeoutMs)) return { ...node, sha256: stored.sha256, manifest: stored.manifest }

  const active = readJson(pathsFor(home).active)
  if (active?.status === 'active' && typeof active.nodePath === 'string' && isWithin(node.nodeRoot, active.nodePath)) {
    throw new Error('The active OpenClaw runtime owns the isolated Node directory and cannot be replaced')
  }
  const shasums = await responseBytes(node.shasums, { fetchImpl, maxBytes: MAX_SHASUMS_BYTES })
  const expected = nodeChecksum(shasums.toString('utf8'), node.filename)
  const archive = await responseBytes(node.url, { fetchImpl, maxBytes: MAX_NODE_ARCHIVE_BYTES })
  const actual = nodeSha256(archive)
  if (actual !== expected) throw new Error('Official Node archive SHA-256 does not match SHASUMS256.txt')
  writeDownload(node.archivePath, archive)
  assertSafeDirectoryPath(dirname(node.nodeRoot))
  if (existsSync(node.nodeRoot)) assertSafeDirectoryPath(node.nodeRoot, { allowMissing: false })
  rmSync(node.nodeRoot, { recursive: true, force: true })
  const extractionScript = `Expand-Archive -LiteralPath '${node.archivePath.replaceAll("'", "''")}' -DestinationPath '${join(runtimeRoot, 'node').replaceAll("'", "''")}' -Force`
  const extraction = await runner.run('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(extractionScript, 'utf16le').toString('base64'),
  ], {
    cwd: runtimeRoot,
    env: scrubEnvironment(home, runtimeRoot, DEFAULT_PORT),
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }, timeoutMs)
  if (processTreeIsUncertain(extraction)) throw processTreeUncertainError('node-extraction', extraction)
  if (extraction?.exitCode !== 0 || !existsSync(node.nodePath) || !existsSync(node.npmPath)) {
    throw new Error('Official Node archive extraction failed or omitted node/npm')
  }
  scanExtractedTree(node.nodeRoot)
  if (!await runNodeVersion(node, home, runtimeRoot, runner, timeoutMs)) throw new Error('Official Node --version diagnostic did not match the pinned version')
  const manifest = digestTree(node.nodeRoot, { excluded: new Set(['.phoenix-node.json']) })
  writeJsonAtomic(node.markerPath, { version, platform: OFFICIAL_NODE_PLATFORM, sha256: actual, manifest })
  return { ...node, sha256: actual, manifest }
}

function installEnvironment(home, runtimeRoot) {
  const env = scrubEnvironment(home, runtimeRoot, DEFAULT_PORT)
  env.NPM_CONFIG_USERCONFIG = join(runtimeRoot, 'npmrc')
  env.NPM_CONFIG_CACHE = join(runtimeRoot, 'npm-cache')
  env.NPM_CONFIG_GLOBAL = 'false'
  env.NPM_CONFIG_IGNORE_SCRIPTS = 'true'
  env.NPM_CONFIG_AUDIT = 'false'
  env.NPM_CONFIG_FUND = 'false'
  return env
}

async function ensureOpenClawPackage({ home, runtimeRoot, runtimePath, artifactPath, node, runner, timeoutMs = DEFAULT_PROCESS_TIMEOUT_MS }) {
  const entryPath = join(runtimePath, 'node_modules', 'openclaw', 'openclaw.mjs')
  const packagedEntry = archiveEntry(artifactPath, 'package/openclaw.mjs')
  try {
    if (readFileSync(entryPath).equals(packagedEntry)) return entryPath
  } catch { /* candidate entrypoint is not staged yet */ }
  assertSafeDirectoryPath(runtimeRoot)
  if (existsSync(runtimePath)) assertSafeDirectoryPath(runtimePath, { allowMissing: false })
  rmSync(runtimePath, { recursive: true, force: true })
  mkdirSync(runtimePath, { recursive: true })
  const result = await runner.run(node.nodePath, [
    join(node.nodeRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    'install', '--prefix', runtimePath, '--no-save', '--no-package-lock', '--ignore-scripts',
    '--omit=dev', '--no-audit', '--fund=false', artifactPath,
  ], {
    cwd: runtimePath,
    env: installEnvironment(home, runtimeRoot),
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }, timeoutMs)
  if (processTreeIsUncertain(result)) throw processTreeUncertainError('openclaw-install', result)
  if (result?.exitCode === null || result === BOUNDED_TIMEOUT) {
    throw Object.assign(new Error('OpenClaw npm install timed out'), { code: 'OPENCLAW_NPM_INSTALL_TIMEOUT' })
  }
  if (result === undefined || result === null) {
    throw Object.assign(new Error('OpenClaw npm install returned no process result'), { code: 'OPENCLAW_NPM_INSTALL_NO_RESULT' })
  }
  if (result?.exitCode !== 0) {
    throw Object.assign(new Error(`OpenClaw npm install exited with code ${String(result?.exitCode ?? 'unknown')}`), { code: 'OPENCLAW_NPM_INSTALL_FAILED' })
  }
  const installedEntry = join(runtimePath, 'node_modules', 'openclaw', 'openclaw.mjs')
  if (!existsSync(installedEntry)) throw new Error('OpenClaw npm install omitted the official entrypoint')
  const installedBytes = readFileSync(installedEntry)
  if (!installedBytes.equals(packagedEntry)) throw new Error('OpenClaw installed entrypoint does not match the verified tarball')
  return entryPath
}

async function downloadOfficialArtifact({ version, registry, artifactPath, fetchImpl }) {
  try {
    if (hashFile(artifactPath) === registry.dist.sha512) return
  } catch { /* artifact is absent or unreadable */ }
  const artifact = await responseBytes(registry.dist.tarball, { fetchImpl, maxBytes: MAX_OPENCLAW_TARBALL_BYTES })
  if (createHash('sha512').update(artifact).digest('hex') !== registry.dist.sha512) {
    throw new Error('OpenClaw tarball SHA-512 does not match official registry metadata')
  }
  writeDownload(artifactPath, artifact)
}

/**
 * Return a secret-free view of the Codex/Phoenix and OpenClaw execution state.
 * @param {object} options
 * @param {string} options.home - DSH_HOME containing the isolated OpenClaw state.
 * @param {string} [options.phoenixRoot] - Phoenix root containing its managed marker.
 * @param {string} [options.phoenixControlDirectory] - Phoenix control directory containing active/update state.
 * @returns {Promise<object>} Unified engine and update status.
 */
export async function inspectExecutionEngines({ home, phoenixRoot, phoenixControlDirectory } = {}) {
  const resolvedHome = requireHome(home)
  const paths = pathsFor(resolvedHome)
  const control = resolve(phoenixControlDirectory ?? phoenixRoot ?? resolvedHome)
  const phoenix = readPhoenixState(control, phoenixRoot && resolve(phoenixRoot))
  const codex = readCodexState(resolvedHome)
  const candidate = markerForInspection(readJson(paths.candidate))
  const active = markerForInspection(readJson(paths.active))
  return {
    schema: SCHEMA,
    at: new Date().toISOString(),
    engines: {
      codex: codex ? { id: 'codex', status: 'active', version: codex.version, bin: codex.bin } : { id: 'codex', status: 'unavailable' },
      openclaw: active?.status === 'active'
        ? { id: 'openclaw', status: 'active', version: active.version, port: active.port }
        : active?.status === 'stopped'
          ? { id: 'openclaw', status: 'stopped', version: active.version, port: active.port }
          : candidate?.status === 'prepared'
            ? { id: 'openclaw', status: 'prepared', version: candidate.version }
            : { id: 'openclaw', status: 'unavailable' },
    },
    updates: {
      phoenix,
      openclaw: { candidate, active },
    },
  }
}

/**
 * Download and stage a pinned official OpenClaw distribution with its own
 * verified Node runtime. Installation is local to the version directory,
 * ignores package scripts, and never changes the active marker.
 * @param {object} options
 * @param {string} options.home - DSH_HOME containing the isolated runtime.
 * @param {string} [options.version] - Exact OpenClaw npm version to prepare.
 * @param {string} [options.nodeVersion] - Exact official Windows Node version.
 * @param {Function} [options.fetchImpl] - Injectable fetch implementation for tests.
 * @param {object} [options.runner] - Injectable process runner for tests.
 * @returns {Promise<object>} Prepared candidate and version diagnostics.
 */
export async function prepareOpenClawOfficial({ home, version = '2026.10.6', nodeVersion = OFFICIAL_NODE_VERSION, fetchImpl, runner, nodeTimeoutMs = DEFAULT_PROCESS_TIMEOUT_MS, installTimeoutMs = DEFAULT_INSTALL_TIMEOUT_MS, applyRetention = false, retentionConfirm = false } = {}) {
  const resolvedHome = requireHome(home)
  const paths = pathsFor(resolvedHome)
  const priorBlocked = runtimeBlockedResult(paths.root)
  if (priorBlocked) return priorBlocked
  const release = acquirePreparationLock(paths.root)
  const effectiveRunner = runnerFor(runner)
  let retainLock = false
  try {
    const active = readJson(paths.active)
    if (active?.status === 'active' && active.version === version) return { status: 'already-active', version }
    const registry = await fetchOfficialRegistryMetadata(version, fetchImpl)
    const runtimePath = join(paths.root, 'versions', version)
    if (active?.status === 'active' && typeof active.runtimePath === 'string' && resolve(active.runtimePath) === resolve(runtimePath)) {
      return { status: 'blocked', code: 'ACTIVE_RUNTIME_CONFLICT' }
    }
    const node = await prepareNodeRuntime({
      home: resolvedHome,
      runtimeRoot: paths.root,
      version: nodeVersion,
      fetchImpl,
      runner: effectiveRunner,
      timeoutMs: nodeTimeoutMs,
    })
    const artifactPath = join(paths.root, 'artifacts', `openclaw-${version}.tgz`)
    const entryPath = join(runtimePath, 'node_modules', 'openclaw', 'openclaw.mjs')
    await downloadOfficialArtifact({ version, registry, artifactPath, fetchImpl })
    await ensureOpenClawPackage({
      home: resolvedHome,
      runtimeRoot: paths.root,
      runtimePath,
      artifactPath,
      node,
      runner: effectiveRunner,
      timeoutMs: installTimeoutMs,
    })
    const staged = validatedCandidate(resolvedHome, {
      version,
      nodePath: node.nodePath,
      entryPath,
      runtimePath,
      artifactPath,
      registry,
    }, { requireManifests: false })
    const candidate = validatedCandidate(resolvedHome, {
      ...staged,
      installedManifest: digestTree(staged.runtimePath),
      nodeManifest: node.manifest,
    })
    writeJsonAtomic(paths.candidate, {
      ...candidate,
      nodeVersion,
      nodePlatform: OFFICIAL_NODE_PLATFORM,
      nodeZipSha256: node.sha256,
      preparedAt: new Date().toISOString(),
    })
    return {
      status: 'prepared',
      candidate,
      diagnostics: { nodeVersion, nodePath: node.nodePath, npmPath: node.npmPath },
      retention: retentionReceipt(resolvedHome, { apply: applyRetention, confirm: retentionConfirm }),
    }
  } catch (error) {
    if (error?.code === 'OPENCLAW_PROCESS_TREE_UNCERTAIN') {
      retainLock = true
      let blocked
      try { blocked = writeRuntimeBlocked(paths.root, error.operation ?? 'prepare-openclaw', error) } catch { /* preserve the lock if the durable marker cannot be replaced */ }
      return {
        status: 'blocked',
        code: error.code,
        ...(Number.isInteger(error.pid) ? { pid: error.pid } : {}),
        operation: error.operation ?? 'prepare-openclaw',
        ...(blocked ? { blockedAt: blocked.blockedAt } : {}),
      }
    }
    throw error
  } finally {
    if (!retainLock) release()
  }
}

/**
 * Verify and persist an official, already-present OpenClaw distribution candidate.
 * Registry metadata is fetched independently before the local artifact is accepted;
 * no package-manager mutation is performed.
 * @param {object} options
 * @param {string} options.home - DSH_HOME containing the isolated OpenClaw state.
 * @param {object} options.candidate - Pinned candidate metadata and local artifact paths.
 * @param {Function} [options.fetchImpl] - Injectable official registry fetch for tests.
 * @returns {Promise<object>} Prepared status and the scrubbed candidate metadata.
 */
export async function prepareOpenClawCandidate({ home, candidate, fetchImpl, applyRetention = false, retentionConfirm = false } = {}) {
  const resolvedHome = requireHome(home)
  const paths = pathsFor(resolvedHome)
  const priorBlocked = runtimeBlockedResult(paths.root)
  if (priorBlocked) return priorBlocked
  const release = acquirePreparationLock(paths.root)
  try {
    const official = await fetchOfficialRegistryMetadata(candidate?.version, fetchImpl)
    if (candidate?.registry?.name !== official.name
      || candidate?.registry?.version !== official.version
      || candidate?.registry?.repository !== official.repository
      || candidate?.registry?.dist?.tarball !== official.dist.tarball
      || candidate?.registry?.dist?.sha512 !== official.dist.sha512) {
      throw new Error('OpenClaw candidate metadata does not match independently fetched official registry metadata')
    }
    const staged = validatedCandidate(resolvedHome, { ...candidate, registry: official }, { requireManifests: false })
    const prepared = validatedCandidate(resolvedHome, {
      ...staged,
      installedManifest: digestTree(staged.runtimePath),
      nodeManifest: digestTree(dirname(staged.nodePath), { excluded: new Set(['.phoenix-node.json']) }),
    })
    // Keep callers that retain their input object aligned with the durable
    // candidate marker. This also prevents an immediate active-marker write
    // from silently dropping the verified manifests.
    Object.assign(candidate, prepared)
    writeJsonAtomic(paths.candidate, { ...prepared, preparedAt: new Date().toISOString() })
    return { status: 'prepared', candidate: prepared, retention: retentionReceipt(resolvedHome, { apply: applyRetention, confirm: retentionConfirm }) }
  } finally {
    release()
  }
}

/**
 * Health-check and activate the prepared OpenClaw candidate without interrupting busy Phoenix work.
 * @param {object} options
 * @param {string} options.home - DSH_HOME containing the isolated OpenClaw state.
 * @param {object} [options.execution] - Phoenix execution snapshot; live or uncertain work defers activation.
 * @returns {Promise<object>} Activated, deferred, or fail-closed status.
 */
export async function activateOpenClawCandidate({ home, execution, phoenixExecution, runner, port, env, healthTimeoutMs, healthIntervalMs, stopTimeoutMs, applyRetention = false, retentionConfirm = false } = {}) {
  const resolvedHome = requireHome(home)
  return withLifecycleLock(pathsFor(resolvedHome).root, async () => {
    if (executionIsBusy(execution ?? phoenixExecution)) return busyResult()
    const paths = pathsFor(resolvedHome)
    const activeBefore = readJson(paths.active)
    const previousBefore = readJson(paths.previous)
    if (persistedOwnerIsUnknown(activeBefore) && !liveOwnedGateway(paths)) return { status: 'blocked', code: 'OPENCLAW_GATEWAY_OWNER_UNKNOWN' }
    const stored = readJson(paths.candidate)
    if (!stored) return { status: 'blocked', code: 'CANDIDATE_MISSING' }
    let candidate
    try { candidate = validatedCandidate(resolvedHome, stored) } catch { return { status: 'blocked', code: 'CANDIDATE_INVALID' } }
    const result = await replaceGateway({
      home: resolvedHome,
      paths,
      target: candidate,
      activeBefore,
      previousBefore,
      runner,
      port,
      env,
      healthTimeoutMs,
      healthIntervalMs,
      stopTimeoutMs,
      resultStatus: 'activated',
    })
    if (result.status === 'activated') return { ...result, retention: retentionReceipt(resolvedHome, { apply: applyRetention, confirm: retentionConfirm }) }
    return result
  })
}

/**
 * Activate the last verified OpenClaw marker after a health check.
 * @param {object} options
 * @param {string} options.home - DSH_HOME containing isolated OpenClaw state.
 * @param {object} [options.execution] - Phoenix execution snapshot used to defer busy rollback.
 * @returns {Promise<object>} Rolled-back, deferred, or fail-closed status.
 */
export async function rollbackOpenClawCandidate({ home, execution, phoenixExecution, runner, healthTimeoutMs, healthIntervalMs, stopTimeoutMs, applyRetention = false, retentionConfirm = false } = {}) {
  const resolvedHome = requireHome(home)
  return withLifecycleLock(pathsFor(resolvedHome).root, async () => {
    if (executionIsBusy(execution ?? phoenixExecution)) return busyResult()
    const paths = pathsFor(resolvedHome)
    const activeBefore = readJson(paths.active)
    const previousBefore = readJson(paths.previous)
    if (persistedOwnerIsUnknown(activeBefore) && !liveOwnedGateway(paths)) return { status: 'blocked', code: 'OPENCLAW_GATEWAY_OWNER_UNKNOWN' }
    const previous = readJson(paths.previous)
    if (previous?.status === 'none') return { status: 'rolled-back', code: 'NO_PREVIOUS', retention: retentionReceipt(resolvedHome, { apply: applyRetention, confirm: retentionConfirm }) }
    if (!previous) return { status: 'blocked', code: 'PREVIOUS_MISSING' }
    let spec
    try { spec = launchSpec(resolvedHome, previous) } catch { return { status: 'blocked', code: 'PREVIOUS_INVALID' } }
    const result = await replaceGateway({
      home: resolvedHome,
      paths,
      target: spec,
      activeBefore,
      previousBefore,
      runner,
      port: previous.port,
      healthTimeoutMs,
      healthIntervalMs,
      stopTimeoutMs,
      resultStatus: 'rolled-back',
    })
    if (result.status === 'rolled-back') return { ...result, retention: retentionReceipt(resolvedHome, { apply: applyRetention, confirm: retentionConfirm }) }
    return result
  })
}

/**
 * Start the active isolated OpenClaw gateway with fixed loopback arguments.
 * @param {object} options
 * @param {string} options.home - DSH_HOME containing isolated OpenClaw state.
 * @param {object} [options.execution] - Live Phoenix execution; a busy snapshot defers replacement.
 * @returns {Promise<object>} Ready or fail-closed status.
 */
export async function startOpenClawGateway({ home, execution, phoenixExecution, runner, port, env, healthTimeoutMs, healthIntervalMs, stopTimeoutMs, applyRetention = false, retentionConfirm = false } = {}) {
  const resolvedHome = requireHome(home)
  return withLifecycleLock(pathsFor(resolvedHome).root, async () => {
    // Restarting an unhealthy owned gateway can terminate a native task.
    if (executionIsBusy(execution ?? phoenixExecution)) return busyResult()
    const paths = pathsFor(resolvedHome)
    const active = readJson(paths.active)
    if (!active || active.status === 'none') return { status: 'blocked', code: 'ACTIVE_MISSING' }
    if (persistedOwnerIsUnknown(active) && !liveOwnedGateway(paths)) return { status: 'blocked', code: 'OPENCLAW_GATEWAY_OWNER_UNKNOWN' }
    let spec
    try { spec = launchSpec(resolvedHome, active) } catch { return { status: 'blocked', code: 'ACTIVE_INVALID' } }
    const existing = runningGateways.get(paths.root)
    if (existing?.child && !childExited(existing.child) && env === undefined && port === undefined) {
      const ready = await healthCheck(resolvedHome, spec, existing.child, existing.runner, existing.port, healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS, healthIntervalMs ?? DEFAULT_HEALTH_INTERVAL_MS, env)
      if (ready) return { status: 'ready', version: spec.version, port: existing.port }
      const stopped = await quiesceCurrentGateway({ paths, active, runner, stopTimeoutMs })
      if (stopped.status !== 'stopped') return stopped
    }
    const launch = await launchGateway(resolvedHome, spec, { runner, port: port ?? active.port, env, healthTimeoutMs, healthIntervalMs, stopTimeoutMs })
    if (launch.status !== 'ready') return launch
    const next = activeMarker(spec, launch)
    try { writeJsonAtomic(paths.active, next) } catch {
      const stopped = await stopChild(launch.child, launch.runner, stopTimeoutMs)
      return { status: 'blocked', code: stopped ? 'ACTIVE_MARKER_WRITE_FAILED' : 'ACTIVE_MARKER_WRITE_FAILED_ORPHAN' }
    }
    runningGateways.set(paths.root, { child: launch.child, runner: launch.runner, port: launch.port })
    return { status: 'ready', version: spec.version, port: launch.port, retention: retentionReceipt(resolvedHome, { apply: applyRetention, confirm: retentionConfirm }) }
  })
}

/**
 * Stop the managed OpenClaw gateway and retain its active marker for restart/rollback.
 * @param {object} options
 * @param {string} options.home - DSH_HOME containing isolated OpenClaw state.
 * @param {object} [options.execution] - Live Phoenix execution; a busy snapshot defers stop.
 * @returns {Promise<object>} Stopped or missing status.
 */
export async function stopOpenClawGateway({ home, execution, phoenixExecution, runner, stopTimeoutMs, applyRetention = false, retentionConfirm = false } = {}) {
  const resolvedHome = requireHome(home)
  return withLifecycleLock(pathsFor(resolvedHome).root, async () => {
    // An explicit busy execution must never be interrupted by maintenance.
    if (executionIsBusy(execution ?? phoenixExecution)) return busyResult()
    const paths = pathsFor(resolvedHome)
    const active = readJson(paths.active)
    if (!active || active.status === 'none') return { status: 'stopped', code: 'ACTIVE_MISSING' }
    const existing = runningGateways.get(paths.root)
    if (persistedOwnerIsUnknown(active) && !liveOwnedGateway(paths)) return { status: 'blocked', code: 'OPENCLAW_GATEWAY_OWNER_UNKNOWN' }
    const effectiveRunner = existing?.runner ?? runnerFor(runner)
    try {
      if (existing?.child && !await stopChild(existing.child, effectiveRunner, stopTimeoutMs)) return { status: 'blocked', code: 'GATEWAY_STOP_TIMEOUT' }
    } catch {
      return { status: 'blocked', code: 'GATEWAY_STOP_FAILED' }
    }
    runningGateways.delete(paths.root)
    const withoutPid = { ...active }
    delete withoutPid.pid
    try {
      writeJsonAtomic(paths.active, { ...withoutPid, status: 'stopped', stoppedAt: new Date().toISOString() })
    } catch {
      return { status: 'blocked', code: 'ACTIVE_MARKER_WRITE_FAILED' }
    }
    return { status: 'stopped', version: active.version, retention: retentionReceipt(resolvedHome, { apply: applyRetention, confirm: retentionConfirm }) }
  })
}
