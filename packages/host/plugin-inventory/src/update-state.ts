/** Local bridge between the stable updater's Git-owned state and trusted Host RPCs. */

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type {
  PhoenixUpdateRestartReceipt,
  PhoenixUpdateRefreshReceipt,
  PhoenixUpdateSnapshot,
  PhoenixUpdateStatus,
} from './types.ts'

const STATE_FILE = 'phoenix-update-state.json'
const RESTART_REQUEST_FILE = 'phoenix-update-restart-request.json'
const REFRESH_REQUEST_FILE = 'phoenix-update-refresh-request.json'
const SHA_PATTERN = /^[0-9a-f]{40}$/i
const STATE_READ_ATTEMPTS = 3
const STATE_READ_RETRY_MS = 12
const STATE_WRITE_ATTEMPTS = 4
const STATE_WRITE_RETRY_MS = 20
const STATUSES: ReadonlySet<PhoenixUpdateStatus> = new Set([
  'idle', 'checking', 'current', 'available', 'preparing', 'ready', 'restarting',
  'applying', 'rolling-back', 'updated', 'rolled-back', 'paused', 'error',
  'rollback-failed', 'off',
])

/** Default checkout root selected by the PHOENIX launcher. */
function runtimeRoot(): string {
  const configured = process.env.PHOENIX_RUNTIME_ROOT?.trim()
  return resolve(configured === undefined || configured.length === 0 ? process.cwd() : configured)
}

/** Resolve the repository Git directory without assuming `.git` is a directory. */
function gitDirectory(root: string): string | undefined {
  const result = spawnSync('git', ['rev-parse', '--git-dir'], {
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

/** Resolve the shared Git control directory used across linked PHOENIX worktrees. */
function gitCommonDirectory(root: string): string | undefined {
  const result = spawnSync('git', ['rev-parse', '--git-common-dir'], {
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

/** Match the updater's control-file location even when Host runs in an isolated worktree. */
function controlDirectory(root: string): string | undefined {
  return gitCommonDirectory(root) ?? gitDirectory(root)
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
    if (
      snapshot.status === 'ready'
      && snapshot.target !== undefined
      && queuedRestartTarget(controlDir) === snapshot.target
    ) {
      return { ...snapshot, status: 'restarting', phase: 'restart' }
    }
    return snapshot
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
