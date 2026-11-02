/** Type declarations for the durable updater live-output helper. */

/**
 * Pin the trusted updater helper and its exact matching state module outside
 * disposable worktrees; absence of telemetry does not block native commands.
 * @param sourceRoot - Root containing the updater's scripts directory.
 * @param statePath - Update state file inside the durable Git control directory.
 * @returns Stable helper file path, or undefined when unavailable.
 */
export declare function pinPhoenixUpdateLiveHelper(
  sourceRoot: string,
  statePath: string | undefined,
): string | undefined

/**
 * Revalidate cached helper and companion module before execution.
 * @param helper - Pinned module file path.
 * @returns Whether both source modules still match their content digest.
 */
export declare function validPinnedPhoenixUpdateLiveHelper(
  helper: string | undefined,
): boolean
