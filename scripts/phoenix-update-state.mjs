import { randomUUID } from 'node:crypto'
import { renameSync, unlinkSync, writeFileSync } from 'node:fs'

const REPLACE_ATTEMPTS = 4
const REPLACE_RETRY_MS = 20

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

/**
 * Persist one updater state document without exposing a partially written JSON
 * file to the Host polling process.
 *
 * @param {string} path - destination state path
 * @param {unknown} value - JSON-serializable state value
 * @returns {void}
 */
export function writePhoenixUpdateState(path, value) {
  // A shared .tmp path lets concurrent updater processes delete each other's
  // pending document. The unique name keeps each replacement independent.
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
