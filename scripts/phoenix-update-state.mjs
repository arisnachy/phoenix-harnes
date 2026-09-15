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

function requestPreparedActivation(path, value) {
  if (!supervisedAutoActivationEnabled()) return
  if (basename(path) !== UPDATE_STATE_FILE) return
  if (value?.schema !== 1 || value?.status !== 'ready') return
  if (typeof value.target !== 'string' || !/^[0-9a-f]{40}$/iu.test(value.target)) return

  const controlDirectory = dirname(path)
  const now = new Date().toISOString()
  writeJsonAtomic(join(controlDirectory, UPDATE_RESTART_FILE), {
    schema: 1,
    target: value.target,
    requestedAt: now,
    requestedByPid: process.pid,
    source: 'updater-ready-state',
  })
  writeJsonAtomic(join(controlDirectory, HOST_RESTART_FILE), {
    schema: 1,
    kind: 'host-restart',
    requestedAt: now,
    requestedByPid: process.pid,
    reason: `verified stable update ${value.target.slice(0, 12)} ready; activate and restart`,
    source: 'updater-ready-state',
  })
}

/**
 * Persist one updater state document without exposing a partially written JSON
 * file to the Host polling process. A supervised auto-update that reaches the
 * verified `ready` state also durably requests activation and a Host restart,
 * so the prepared-update bridge is a compatibility fallback rather than a
 * single point of failure.
 *
 * @param {string} path - destination state path
 * @param {unknown} value - JSON-serializable state value
 * @returns {void}
 */
export function writePhoenixUpdateState(path, value) {
  writeJsonAtomic(path, value)
  requestPreparedActivation(path, value)
}
