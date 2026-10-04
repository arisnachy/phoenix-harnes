import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

/**
 * Add repository-scoped Git safe.directory entries to a child-process environment.
 *
 * This uses Git's command-scope environment instead of mutating the user's
 * global Git config, so PHOENIX can operate its own checkout even when Windows
 * reports an administrator-owned parent directory.
 *
 * @param {NodeJS.ProcessEnv} env Base environment.
 * @param {readonly string[]} directories Repository/worktree directories to trust.
 * @returns {NodeJS.ProcessEnv} Environment carrying the appended Git config entries.
 */
export function gitSafeDirectoryEnvironment(env, directories) {
  const next = { ...env }
  const parsed = Number.parseInt(next.GIT_CONFIG_COUNT ?? '0', 10)
  let count = Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
  const known = new Set()

  for (let index = 0; index < count; index += 1) {
    if (next[`GIT_CONFIG_KEY_${String(index)}`] !== 'safe.directory') continue
    const value = next[`GIT_CONFIG_VALUE_${String(index)}`]
    if (typeof value === 'string' && value.length > 0) known.add(value.toLowerCase())
  }

  for (const directory of directories) {
    if (typeof directory !== 'string' || directory.trim().length === 0) continue
    const normalized = resolve(directory).replaceAll('\\', '/')
    if (known.has(normalized.toLowerCase())) continue
    next[`GIT_CONFIG_KEY_${String(count)}`] = 'safe.directory'
    next[`GIT_CONFIG_VALUE_${String(count)}`] = normalized
    known.add(normalized.toLowerCase())
    count += 1
  }

  next.GIT_CONFIG_COUNT = String(count)
  return next
}


/**
 * Persist one exact safe.directory entry in the current user's Git config.
 *
 * PHOENIX uses this only after the caller has verified that the checkout is
 * the official Phoenix repository. Wildcard trust is intentionally refused.
 *
 * @param {string} directory Exact repository directory to trust.
 * @param {NodeJS.ProcessEnv} [env] Environment used for the Git config command.
 * @returns {boolean} Whether the exact entry is present after the operation.
 */
export function persistGitSafeDirectory(directory, env = process.env) {
  if (typeof directory !== 'string' || directory.trim().length === 0 || directory.includes('*')) {
    return false
  }
  const normalized = resolve(directory).replaceAll('\\', '/')
  const options = {
    cwd: homedir(),
    env,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }
  const existing = spawnSync('git', ['config', '--global', '--get-all', 'safe.directory'], options)
  if (existing.error !== undefined) return false
  if (existing.status !== 0 && existing.status !== 1) return false
  const values = typeof existing.stdout === 'string'
    ? existing.stdout.split(/\r?\n/u).map(value => value.trim()).filter(Boolean)
    : []
  if (values.some(value => value.toLowerCase() === normalized.toLowerCase())) return true

  const added = spawnSync('git', ['config', '--global', '--add', 'safe.directory', normalized], options)
  return added.error === undefined && added.status === 0
}
