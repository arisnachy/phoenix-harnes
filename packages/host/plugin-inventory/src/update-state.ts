/** Local bridge between the stable updater's Git-owned state and trusted Host RPCs. */

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type {
  PhoenixUpdateRestartReceipt,
  PhoenixUpdateRefreshReceipt,
  PhoenixUpdateSnapshot,
  PhoenixUpdateStatus,
  PhoenixUpdateEvent,
  PhoenixUpdateConsoleLine,
} from './types.ts'

const STATE_FILE = 'phoenix-update-state.json'
const PROGRESS_JOURNAL_FILE = 'phoenix-update-events.jsonl'
const LIVE_CONSOLE_FILE = 'phoenix-update-live.jsonl'
const MAX_CONSOLE_READ_BYTES = 160 * 1024
const MAX_CONSOLE_LINES = 72
const MAX_EVENT_READ_BYTES = 256 * 1024
const MAX_DIAGNOSTIC_CHARS = 96 * 1024
const MAX_DISPLAY_EVENTS = 24
const RESTART_REQUEST_FILE = 'phoenix-update-restart-request.json'
const REFRESH_REQUEST_FILE = 'phoenix-update-refresh-request.json'
const SHA_PATTERN = /^[0-9a-f]{40}$/i
const STATE_READ_ATTEMPTS = 3
const STATE_READ_RETRY_MS = 12
const STATE_WRITE_ATTEMPTS = 4
const STATE_WRITE_RETRY_MS = 20
const GIT_FILE_MARKER_MAX_BYTES = 4096
const EVENT_STEPS = new Set([
  'git-worktree', 'git-reset', 'git-clean', 'dependencies', 'build',
  'smoke', 'boot-preflight', 'handoff', 'host-restart', 'health-check',
  'runtime-activation', 'rollback', 'checking', 'available', 'preparing',
  'ready', 'restarting', 'applying', 'updated', 'current', 'rolling-back',
  'rolled-back', 'error', 'rollback-failed', 'paused',
])

const STATUSES: ReadonlySet<PhoenixUpdateStatus> = new Set([
  'idle', 'checking', 'current', 'available', 'preparing', 'ready', 'restarting',
  'applying', 'rolling-back', 'updated', 'rolled-back', 'paused', 'error',
  'rollback-failed', 'off',
])

type ControlDirectoryCacheEntry = {
  marker: string
  controlDir: string | undefined
}

const controlDirectoryCache = new Map<string, ControlDirectoryCacheEntry>()

/** Default checkout root selected by the PHOENIX launcher. */
function runtimeRoot(): string {
  const configured = process.env.PHOENIX_RUNTIME_ROOT?.trim()
  return resolve(configured === undefined || configured.length === 0 ? process.cwd() : configured)
}

/** Resolve the repository Git directory without assuming `.git` is a directory. */
function gitDirectory(root: string): string | undefined {
  return resolveGitDirectory(root, '--git-dir')
}

/** Resolve the shared Git control directory used across linked PHOENIX worktrees. */
function gitCommonDirectory(root: string): string | undefined {
  return resolveGitDirectory(root, '--git-common-dir')
}

function resolveGitDirectory(root: string, flag: '--git-dir' | '--git-common-dir'): string | undefined {
  const result = spawnSync('git', ['rev-parse', flag], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.status !== 0 || typeof result.stdout !== 'string') return undefined
  const value = result.stdout.trim()
  if (value.length === 0) return undefined
  return isAbsolute(value) ? value : resolve(root, value)
}

/** Return a cheap signature for the checkout's Git marker used to invalidate path resolution. */
function gitMarker(root: string): string {
  const markerPath = join(root, '.git')
  try {
    const stat = lstatSync(markerPath)
    const kind = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other'
    if (!stat.isFile()) return [kind, stat.dev, stat.ino].join(':')
    const content = stat.size <= GIT_FILE_MARKER_MAX_BYTES ? readFileSync(markerPath, 'utf8') : undefined
    return [kind, stat.dev, stat.ino, stat.size, stat.mtimeMs, content].join(':')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : `error:${code ?? 'unknown'}`
  }
}

/** Match the updater's control-file location even when Host runs in an isolated worktree. */
function controlDirectory(root: string): string | undefined {
  const key = resolve(root)
  const marker = gitMarker(key)
  const cached = controlDirectoryCache.get(key)
  if (cached?.marker === marker) return cached.controlDir

  const controlDir = gitCommonDirectory(key) ?? gitDirectory(key)
  controlDirectoryCache.set(key, { marker, controlDir })
  return controlDir
}

/** Return one optional bounded string field from an updater state object. */
function textField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value.slice(0, 2048) : undefined
}

/** Return one optional commit field only when it is a full Git SHA. */
function commitField(record: Record<string, unknown>, key: string): string | undefined {
  const value = textField(record, key)
  return value !== undefined && SHA_PATTERN.test(value) ? value : undefined
}

/** Read a state document again when a watcher write races the Host read. */
function readStateJson(path: string): unknown {
  let lastError: unknown
  for (let attempt = 1; attempt <= STATE_READ_ATTEMPTS; attempt += 1) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      lastError = error
      if (attempt < STATE_READ_ATTEMPTS) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, STATE_READ_RETRY_MS)
      }
    }
  }
  throw lastError
}

/** Replace one updater JSON document without exposing a partial write to readers. */
function writeStateJson(path: string, value: unknown): void {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  let lastError: unknown
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    for (let attempt = 1; attempt <= STATE_WRITE_ATTEMPTS; attempt += 1) {
      try {
        renameSync(temporaryPath, path)
        return
      } catch (error) {
        lastError = error
        const code = (error as NodeJS.ErrnoException).code
        if (!['EACCES', 'EBUSY', 'EPERM'].includes(code ?? '') || attempt === STATE_WRITE_ATTEMPTS) throw error
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, STATE_WRITE_RETRY_MS)
      }
    }
    throw lastError
  } finally {
    try {
      unlinkSync(temporaryPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

/** Read the exact update target already queued for activation, if any. */
function queuedRestartTarget(controlDir: string): string | undefined {
  const path = join(controlDir, RESTART_REQUEST_FILE)
  if (!existsSync(path)) return undefined
  try {
    const value = readStateJson(path)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const target = (value as Record<string, unknown>).target
    return typeof target === 'string' && SHA_PATTERN.test(target) ? target : undefined
  } catch {
    // A racing/partial legacy marker must never turn a healthy update into an error.
    return undefined
  }
}

/**
 * Parse the updater's durable JSON into the narrow browser-visible vocabulary.
 * @param value - decoded JSON from the repository-owned updater state file.
 * @returns sanitized state, or an error state for an invalid document.
 */
export function parsePhoenixUpdateSnapshot(value: unknown): PhoenixUpdateSnapshot {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'error', detail: 'PHOENIX update state is invalid.' }
  }
  const record = value as Record<string, unknown>
  // Older managed installations used a more specific completion label. Keep
  // that durable state readable so a successful realignment is not presented
  // as an update failure after the Host restarts.
  const status = record.status === 'realigned-stable' ? 'updated' : record.status
  if (typeof status !== 'string' || !STATUSES.has(status as PhoenixUpdateStatus)) {
    return { status: 'error', detail: 'PHOENIX update state has an unknown status.' }
  }

  const phase = textField(record, 'phase')
  const current = commitField(record, 'current')
  const target = commitField(record, 'target')
  const previous = commitField(record, 'previous')
  const failedTarget = commitField(record, 'failedTarget')
  const channelPublishedAt = textField(record, 'channelPublishedAt')
  const detail = textField(record, 'detail')
  const at = textField(record, 'at')

  return {
    status: status as PhoenixUpdateStatus,
    ...(phase === undefined ? {} : { phase }),
    ...(current === undefined ? {} : { current }),
    ...(target === undefined ? {} : { target }),
    ...(previous === undefined ? {} : { previous }),
    ...(failedTarget === undefined ? {} : { failedTarget }),
    ...(channelPublishedAt === undefined ? {} : { channelPublishedAt }),
    ...(detail === undefined ? {} : { detail }),
    ...(at === undefined ? {} : { at }),
  }
}

/**
 * Parse only known, secret-free fields from a durable journal tail.
 * Unknown codes, raw output, and entries from another release target are dropped.
 * @param content - last bytes of the newline-delimited journal.
 * @param target - exact release commit currently being displayed.
 * @returns bounded and validated stage events for the current release.
 */
export function parsePhoenixUpdateEvents(content: string, target?: string): readonly PhoenixUpdateEvent[] {
  const events: PhoenixUpdateEvent[] = []
  for (const line of content.split(/\r?\n/u)) {
    if (!line.startsWith('{"schema":1,')) continue
    try {
      const value = JSON.parse(line) as Record<string, unknown>
      if (value.schema !== 1
        || typeof value.step !== 'string' || !EVENT_STEPS.has(value.step)
        || !['started', 'ok', 'failed', 'info'].includes(String(value.result))
        || typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at))
        || (target !== undefined && value.target !== target)) continue
      const exitCode = value.exitCode
      // Never trust a journal edited externally: validate length, result and
      // redact again at the RPC boundary before returning browser-visible data.
      const diagnostic = typeof value.diagnostic === 'string' && value.result === 'failed'
        ? value.diagnostic.slice(0, MAX_DIAGNOSTIC_CHARS + 100)
          .replace(/\u001b\[[0-9;]*[a-z]/giu, '')
          .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/giu, 'https://[CREDENTIALS_REMOVED]@')
          .replace(/\b(?:sk-(?:proj-)?[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9_]{12,}|github_pat_[a-z0-9_]{12,})\b/giu, '[SECRET_REMOVED]')
          .replace(/\bBearer\s+[^\s"']+/giu, 'Bearer [SECRET_REMOVED]')
          .replace(/(\b(?:password|passwd|token|access_token|refresh_token|api[_-]?key|client_secret|authorization|secret|_authToken)\b\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/giu, '$1[SECRET_REMOVED]')
          .replace(/(\b[a-z0-9_]*(?:TOKEN|API_KEY|PASSWORD|SECRET|AUTH_KEY|PRIVATE_KEY|ACCESS_KEY)\b\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/giu, '$1[SECRET_REMOVED]')
        : undefined
      events.push({
        step: value.step,
        result: value.result as PhoenixUpdateEvent['result'],
        at: value.at,
        ...(typeof exitCode === 'number' && Number.isSafeInteger(exitCode)
          && exitCode >= 0 && exitCode <= 255 ? { exitCode } : {}),
        ...(diagnostic === undefined || diagnostic.length === 0 ? {} : { diagnostic }),
      })
    } catch {
      // Torn/legacy lines are never surfaced to the browser.
    }
  }
  return events.slice(-MAX_DISPLAY_EVENTS)
}

/** Read the last bounded portion of the journal, without loading long build logs. */
function readPhoenixUpdateEvents(controlDir: string, target?: string): readonly PhoenixUpdateEvent[] {
  const path = join(controlDir, PROGRESS_JOURNAL_FILE)
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const size = fstatSync(fd).size
    const count = Math.min(size, MAX_EVENT_READ_BYTES)
    if (count <= 0) return []
    const buffer = Buffer.allocUnsafe(count)
    const bytes = readSync(fd, buffer, 0, count, size - count)
    const raw = buffer.subarray(0, bytes).toString('utf8')
    // When reading the tail, discard the partial first JSON line.
    const boundary = size > count ? raw.indexOf('\n') : -1
    return parsePhoenixUpdateEvents(boundary < 0 ? raw : raw.slice(boundary + 1), target)
  } catch {
    return []
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/**
 * Validate streamed command output at the Host boundary and redact again.
 *
 * @param content - Newline-delimited console records emitted by the updater.
 * @param target - Expected update target; records for other targets are ignored.
 * @param since - Earliest accepted event timestamp in milliseconds since the epoch.
 * @returns Validated, redacted console lines in their original order, limited to the newest entries.
 */
export function parsePhoenixUpdateConsole(
  content: string, target?: string, since = 0,
): readonly PhoenixUpdateConsoleLine[] {
  const rows: PhoenixUpdateConsoleLine[] = []
  for (const raw of content.split(/\r?\n/u)) {
    if (!raw.startsWith('{"schema":1,')) continue
    try {
      const value = JSON.parse(raw) as Record<string, unknown>
      if (value.schema !== 1 || value.target !== target
        || typeof value.step !== 'string' || !EVENT_STEPS.has(value.step)
        || (value.stream !== 'stdout' && value.stream !== 'stderr')
        || typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at))
        || Date.parse(value.at) < since
        || typeof value.line !== 'string' || value.line.length > 2700) continue
      const line = value.line
        .replace(/\u001b\[[0-9;]*[a-z]/giu, '')
        .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/giu, 'https://[CREDENTIALS_REMOVED]@')
        .replace(/\b(?:sk-(?:proj-)?[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9_]{12,}|github_pat_[a-z0-9_]{12,})\b/giu, '[SECRET_REMOVED]')
        .replace(/\bBearer\s+[^\s"']+/giu, 'Bearer [SECRET_REMOVED]')
        .replace(/(\b(?:password|passwd|token|access_token|refresh_token|api[_-]?key|client_secret|authorization|secret|_authToken)\b\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/giu, '$1[SECRET_REMOVED]')
        .replace(/(\b[a-z0-9_]*(?:TOKEN|API_KEY|PASSWORD|SECRET|AUTH_KEY|PRIVATE_KEY|ACCESS_KEY)\b\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/giu, '$1[SECRET_REMOVED]')
      rows.push({ at: value.at, step: value.step, stream: value.stream, line })
    } catch {
      // Partial JSON line from the detached command.
    }
  }
  return rows.slice(-MAX_CONSOLE_LINES)
}

function readPhoenixUpdateConsole(controlDir: string, target?: string, since = 0): readonly PhoenixUpdateConsoleLine[] {
  if (target === undefined) return []
  const path = join(controlDir, LIVE_CONSOLE_FILE)
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const size = fstatSync(fd).size
    const count = Math.min(size, MAX_CONSOLE_READ_BYTES)
    if (count <= 0) return []
    const buffer = Buffer.allocUnsafe(count)
    const bytes = readSync(fd, buffer, 0, count, size - count)
    const raw = buffer.subarray(0, bytes).toString('utf8')
    const boundary = size > count ? raw.indexOf('\n') : -1
    return parsePhoenixUpdateConsole(boundary < 0 ? raw : raw.slice(boundary + 1), target, since)
  } catch {
    return []
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/**
 * Read the current updater state without making updater availability a Host boot dependency.
 * @param root - PHOENIX checkout root; defaults to the launcher-protected runtime root.
 * @returns sanitized durable updater state, or `idle` when no updater state exists.
 */
export function readPhoenixUpdateSnapshot(root: string = runtimeRoot()): PhoenixUpdateSnapshot {
  const controlDir = controlDirectory(root)
  if (controlDir === undefined) return { status: 'idle' }
  const path = join(controlDir, STATE_FILE)
  if (!existsSync(path)) return { status: 'idle' }
  try {
    const snapshot = parsePhoenixUpdateSnapshot(readStateJson(path))
    // In supervised auto-update, writing the durable ready state also queues
    // activation/restart immediately. There is a short window where STATE_FILE
    // still says ready while RESTART_REQUEST_FILE already proves activation is
    // in flight. Never expose an actionable Ready button during that window.
    const events = readPhoenixUpdateEvents(controlDir, snapshot.target)
    const running = ['preparing', 'restarting', 'applying', 'rolling-back'].includes(snapshot.status)
    const phaseSince = Date.parse(snapshot.at ?? '')
    const from = Math.max(Date.now() - 30 * 60_000, Number.isFinite(phaseSince) ? phaseSince - 3000 : 0)
    const consoleLines = running ? readPhoenixUpdateConsole(controlDir, snapshot.target, from) : []
    const extra = {
      ...(events.length > 0 ? { events } : {}),
      ...(consoleLines.length > 0 ? { console: consoleLines } : {}),
    }
    if (
      snapshot.status === 'ready'
      && snapshot.target !== undefined
      && queuedRestartTarget(controlDir) === snapshot.target
    ) {
      return { ...snapshot, status: 'restarting', phase: 'restart', ...extra }
    }
    return { ...snapshot, ...extra }
  } catch {
    return { status: 'error', detail: 'PHOENIX update state could not be read.' }
  }
}

/**
 * Ask the detached updater watcher to activate one already prepared release.
 * The browser never supplies a target: the request is bound to the trusted
 * updater state's exact `ready` target.
 * @param root - PHOENIX checkout root; defaults to the launcher-protected runtime root.
 * @returns whether a restart request was durably accepted.
 */
export function requestPhoenixUpdateRestart(root: string = runtimeRoot()): PhoenixUpdateRestartReceipt {
  const snapshot = readPhoenixUpdateSnapshot(root)
  // Restart requests are idempotent. If automatic activation has already
  // crossed the ready -> restarting boundary, a user click racing that
  // transition must be treated as accepted rather than as a failure.
  if (snapshot.status === 'restarting') {
    return { accepted: true, status: 'restarting' }
  }
  if (snapshot.status !== 'ready' || snapshot.target === undefined) {
    return { accepted: false, status: snapshot.status }
  }
  const controlDir = controlDirectory(root)
  if (controlDir === undefined) return { accepted: false, status: 'error' }

  const at = new Date().toISOString()
  writeStateJson(join(controlDir, RESTART_REQUEST_FILE), {
    schema: 1,
    target: snapshot.target,
    requestedAt: at,
  })
  writeStateJson(join(controlDir, STATE_FILE), {
    schema: 1,
    ...snapshot,
    status: 'restarting',
    phase: 'restart',
    at,
  })
  return { accepted: true, status: 'restarting' }
}

/**
 * Wake the detached updater so a manual refresh performs a real channel check.
 * @param root - PHOENIX checkout root; defaults to the launcher-protected runtime root.
 * @returns whether the refresh request was durably written.
 */
export function requestPhoenixUpdateRefresh(root: string = runtimeRoot()): PhoenixUpdateRefreshReceipt {
  const controlDir = controlDirectory(root)
  if (controlDir === undefined) return { accepted: false }
  writeStateJson(join(controlDir, REFRESH_REQUEST_FILE), {
    schema: 1,
    requestedAt: new Date().toISOString(),
  })
  return { accepted: true }
}
