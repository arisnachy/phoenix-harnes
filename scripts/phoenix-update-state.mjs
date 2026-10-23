import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'

const REPLACE_ATTEMPTS = 4
const REPLACE_RETRY_MS = 20
const UPDATE_STATE_FILE = 'phoenix-update-state.json'
const UPDATE_RESTART_FILE = 'phoenix-update-restart-request.json'
const HOST_RESTART_FILE = 'phoenix-host-restart-request.json'
const ACTIVE_RUNTIME_FILE = 'phoenix-active-runtime.json'
const PROGRESS_JOURNAL_FILE = 'phoenix-update-events.jsonl'
const MAX_PROGRESS_JOURNAL_BYTES = 512 * 1024
const RETAIN_PROGRESS_JOURNAL_BYTES = 32 * 1024
const COMMAND_STEPS = new Set([
  'git-worktree', 'git-reset', 'git-clean', 'dependencies', 'build',
  'smoke', 'boot-preflight', 'handoff', 'host-restart', 'health-check',
  'runtime-activation', 'rollback',
])
const UPDATE_STATUSES = new Set([
  'checking', 'available', 'preparing', 'ready', 'restarting', 'applying',
  'updated', 'current', 'rolling-back', 'rolled-back', 'error',
  'rollback-failed', 'paused',
])

function waitForReplaceRetry() {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, REPLACE_RETRY_MS)
}

function replaceState(temporaryPath, path) {
  let lastError
  for (let attempt = 1; attempt <= REPLACE_ATTEMPTS; attempt += 1) {
    try {
      renameSync(temporaryPath, path)
      return
    } catch (error) {
      lastError = error
      const code = error?.code
      if (!['EACCES', 'EBUSY', 'EPERM'].includes(code) || attempt === REPLACE_ATTEMPTS) throw error
      waitForReplaceRetry()
    }
  }
  throw lastError
}

function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    replaceState(temporaryPath, path)
  } finally {
    try {
      unlinkSync(temporaryPath)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

/**
 * Append a bounded, structured update event to the shared Git control directory.
 * The UI receives vetted step codes, results, and exit codes, never raw
 * PowerShell stdout/stderr, environment variables, file paths, or credentials.
 * Journal failures must not make an otherwise valid update fail.
 *
 * @param {string} statePath - trusted absolute path to the updater's state JSON.
 * @param {string} step - fixed command code or known durable updater status.
 * @param {'started'|'ok'|'failed'|'info'} result - observed command outcome.
 * @param {string|undefined} target - exact stable commit when available.
 * @param {number|undefined} exitCode - observed process exit code.
 * @returns {void}
 */
export function recordPhoenixUpdateStep(statePath, step, result, target, exitCode) {
  if (!COMMAND_STEPS.has(step) && !UPDATE_STATUSES.has(step)) return
  if (!['started', 'ok', 'failed', 'info'].includes(result)) return
  const entry = {
    schema: 1, at: new Date().toISOString(), step, result,
    ...(typeof target === 'string' && /^[a-f0-9]{40}$/iu.test(target) ? { target } : {}),
    ...(Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255 ? { exitCode } : {}),
  }
  try {
    const path = join(dirname(statePath), PROGRESS_JOURNAL_FILE)
    if (existsSync(path) && statSync(path).size > MAX_PROGRESS_JOURNAL_BYTES) {
      const previous = readFileSync(path, 'utf8')
      const suffix = previous.slice(-RETAIN_PROGRESS_JOURNAL_BYTES)
      const newline = suffix.indexOf('\n')
      const compact = newline < 0 ? '' : suffix.slice(newline + 1)
      const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
      try {
        writeFileSync(temporary, compact, { mode: 0o600 })
        replaceState(temporary, path)
      } finally { try { unlinkSync(temporary) } catch { /* replaced or cleaned */ } }
    }
    appendFileSync(path, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 })
  } catch {
    // Informational progress is never authority for activation or rollback.
  }
}

function recordStateTransition(path, state) {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) return
  if (!UPDATE_STATUSES.has(state.status)) return
  if (state.status === 'checking' || state.status === 'current') return
  const failed = state.status === 'error' || state.status === 'rollback-failed'
  const finished = state.status === 'updated' || state.status === 'rolled-back'
  recordPhoenixUpdateStep(path, state.status, failed ? 'failed' : finished ? 'ok' : 'info', state.target)
}

function readActiveRuntimeTarget(controlDirectory) {
  const path = join(controlDirectory, ACTIVE_RUNTIME_FILE)
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (value?.schema !== 1 || typeof value.target !== 'string' || !/^[0-9a-f]{40}$/iu.test(value.target)) return undefined
    if (typeof value.path !== 'string' || value.path.trim().length === 0) return undefined
    const runtimePath = resolve(value.path)
    if (!existsSync(runtimePath)) return undefined
    const head = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: runtimePath,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (head.status !== 0 || head.stdout?.trim() !== value.target) return undefined
    return value.target
  } catch {
    return undefined
  }
}

function clearDuplicateActivationRequests(controlDirectory, target) {
  for (const filename of [UPDATE_RESTART_FILE, HOST_RESTART_FILE]) {
    const path = join(controlDirectory, filename)
    if (!existsSync(path)) continue
    try {
      const value = JSON.parse(readFileSync(path, 'utf8'))
      const matches = filename === UPDATE_RESTART_FILE
        ? value?.schema === 1 && value.target === target
        : value?.schema === 1 && value.kind === 'host-restart'
          && typeof value.reason === 'string' && value.reason.includes(target.slice(0, 12))
      if (matches) unlinkSync(path)
    } catch {
      // Malformed control files remain for the supervisor's fail-closed handling.
    }
  }
}

function supervisedAutoActivationEnabled() {
  const mode = (process.env.PHOENIX_UPDATE_MODE ?? 'auto').trim().toLowerCase()
  return process.env.PHOENIX_UPDATE_SUPERVISED === '1'
    && process.env.PHOENIX_AUTO_UPDATE !== '0'
    && mode === 'auto'
}

function supervisedReadyTarget(path, value) {
  if (!supervisedAutoActivationEnabled()) return undefined
  if (basename(path) !== UPDATE_STATE_FILE) return undefined
  if (value?.schema !== 1 || value?.status !== 'ready') return undefined
  if (typeof value.target !== 'string' || !/^[0-9a-f]{40}$/iu.test(value.target)) return undefined
  return value.target
}

function requestPreparedActivation(path, target, now) {
  const controlDirectory = dirname(path)
  writeJsonAtomic(join(controlDirectory, UPDATE_RESTART_FILE), {
    schema: 1,
    target,
    requestedAt: now,
    requestedByPid: process.pid,
    source: 'updater-ready-state',
  })
  writeJsonAtomic(join(controlDirectory, HOST_RESTART_FILE), {
    schema: 1,
    kind: 'host-restart',
    requestedAt: now,
    requestedByPid: process.pid,
    reason: `verified stable update ${target.slice(0, 12)} ready; activate and restart`,
    source: 'updater-ready-state',
  })
}

/**
 * Persist one updater state document without exposing a partially written JSON
 * file to the Host polling process. A supervised auto-update that reaches the
 * verified `ready` state never exposes an actionable ready window: activation
 * is durably queued first and the browser-visible state is persisted directly
 * as `restarting`. The prepared-update bridge remains a compatibility fallback
 * rather than a single point of failure.
 *
 * @param {string} path - destination state path
 * @param {unknown} value - JSON-serializable state value
 * @returns {void}
 */
export function writePhoenixUpdateState(path, value) {
  const target = supervisedReadyTarget(path, value)
  if (target !== undefined) {
    const controlDirectory = dirname(path)
    if (readActiveRuntimeTarget(controlDirectory) === target) {
      clearDuplicateActivationRequests(controlDirectory, target)
      writeJsonAtomic(path, {
        ...value,
        status: 'current',
        phase: 'idle',
        current: target,
        detail: `Stable ${target.slice(0, 12)} is already active; duplicate activation suppressed.`,
        at: value?.at ?? new Date().toISOString(),
      })
      recordPhoenixUpdateStep(path, 'health-check', 'ok', target)
      return
    }

    const now = new Date().toISOString()
    // Queue activation before publishing the transition. Readers either keep
    // seeing the previous preparing state or see restarting; they never see a
    // clickable ready state while the supervisor is already taking over.
    requestPreparedActivation(path, target, now)
    writeJsonAtomic(path, {
      ...value,
      status: 'restarting',
      phase: 'restart',
      at: value?.at ?? now,
    })
    recordPhoenixUpdateStep(path, 'restarting', 'started', target)
    return
  }
  writeJsonAtomic(path, value)
  recordStateTransition(path, value)
}
