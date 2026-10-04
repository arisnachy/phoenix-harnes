/**
 * Type contract for the runtime JavaScript helper used by both TypeScript and
 * direct Node.js updater/supervisor entrypoints.
 */
export function gitSafeDirectoryEnvironment(
  env: NodeJS.ProcessEnv,
  directories: readonly string[],
): NodeJS.ProcessEnv

/**
 * Persist one exact safe.directory entry in the current user's Git config.
 */
export function persistGitSafeDirectory(
  directory: string,
  env?: NodeJS.ProcessEnv,
): boolean
