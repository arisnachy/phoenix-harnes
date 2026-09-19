import { randomUUID } from 'node:crypto'
import { renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import process from 'node:process'

const REPLACE_ATTEMPTS = 4
const REPLACE_RETRY_MS = 20
const UPDATE_STATE_FILE = 'phoenix-update-state.json'
const UPDATE_RESTART_FILE = 'phoenix-update-restart-request.json'
const HOST_RESTART_FILE = 'phoenix-host-restart-request.json'

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
    return
  }
  writeJsonAtomic(path, value)
}
