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
