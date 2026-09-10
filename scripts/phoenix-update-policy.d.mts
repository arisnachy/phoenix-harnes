/**
 * Match a GitHub HTTPS or SSH remote against the exact configured repository.
 * @param remote - Observed Git remote URL.
 * @param repository - Expected owner/repository identity.
 * @returns Whether the remote identifies the configured source.
 */
export function matchesUpdateRepository(remote: string, repository: string): boolean

/**
 * Return whether a checkout branch is managed by the PHOENIX release updater.
 * @param branch - current checkout branch.
 * @param stableBranch - configured promoted stable branch.
 * @returns whether automatic release mutation is permitted.
 */
export function isManagedReleaseBranch(branch: string, stableBranch?: string): boolean

/**
 * Classify the stable-channel relation before an updater chooses a mutation.
 * @param input - observed checkout and updater state.
 * @returns the permitted watcher action.
 */
export function classifyStableUpdate(input: {
  status: string
  branch: string
  managed: boolean
  mode: string
  stableBranch: string
}): 'apply' | 'replace' | 'notify' | 'development' | 'pause' | 'unchanged'
