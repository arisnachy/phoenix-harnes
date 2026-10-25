/**
 * Pin the trusted updater helper outside disposable Git worktrees.
 *
 * A supervisor may be running from an older isolated runtime while preparing
 * a replacement. Git reset, clean or worktree removal can invalidate the
 * original helper path between existence checking and Node execution.
 * Copy the helper with its matching state module into the durable Git control
 * directory BEFORE launching any worktree-mutating command.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const MODULES = ['phoenix-update-live-command.mjs', 'phoenix-update-state.mjs']

function helperDigest(sources) {
  const hash = createHash('sha256')
  for (let i = 0; i < MODULES.length; i += 1) {
    hash.update(MODULES[i] + '\n' + sources[i].length + '\n' + sources[i])
  }
  return hash.digest('hex')
}

/**
 * Confirm a cached pinned helper is still the exact content-addressed pair.
 * @param {string | undefined} helper - previously pinned file.
 * @returns {boolean} true only for an unmodified complete pair.
 */
export function validPinnedPhoenixUpdateLiveHelper(helper) {
  if (typeof helper !== 'string' || basename(helper) !== MODULES[0]) return false
  try {
    const directory = dirname(helper)
    const sources = MODULES.map(name => readFileSync(join(directory, name), 'utf8'))
    return helperDigest(sources) === basename(directory)
  } catch {
    return false
  }
}

/**
 * Copy a matched pair of helper modules to a content-addressed, persistent
 * location. Unexpected file states disable optional journaling; they must
 * never prevent the caller from running the original updater command.
 *
 * @param {string} sourceRoot - Root of the currently running updater source.
 * @param {string | undefined} statePath - State file in the owner's Git dir.
 * @returns {string | undefined} durable, executable helper path.
 */
export function pinPhoenixUpdateLiveHelper(sourceRoot, statePath) {
  if (typeof statePath !== 'string' || statePath.length === 0) return undefined
  try {
    const sources = MODULES.map(name => readFileSync(join(sourceRoot, 'scripts', name), 'utf8'))
    const destination = join(dirname(statePath), 'phoenix-live-helpers', helperDigest(sources))
    mkdirSync(destination, { recursive: true, mode: 0o700 })
    for (let i = 0; i < MODULES.length; i += 1) {
      const pinned = join(destination, MODULES[i])
      if (!existsSync(pinned)) {
        try {
          writeFileSync(pinned, sources[i], { encoding: 'utf8', flag: 'wx', mode: 0o600 })
        } catch (error) {
          // Another supervised process may have finished the identical file.
          if (error?.code !== 'EEXIST') throw error
        }
      }
      // Never execute a modified or incomplete pinned module.
      if (readFileSync(pinned, 'utf8') !== sources[i]) return undefined
    }
    return join(destination, MODULES[0])
  } catch {
    return undefined
  }
}
