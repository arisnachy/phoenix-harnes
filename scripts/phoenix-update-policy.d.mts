/**
 * Return whether a checkout branch is managed by the PHOENIX release updater.
 * @param branch - current checkout branch.
 * @param stableBranch - configured promoted stable branch.
 * @returns whether automatic release mutation is permitted.
 */
export function isManagedReleaseBranch(branch: string, stableBranch?: string): boolean

/**
 * Select the safe Git operation for a prepared stable target.
 * @param input - Git ancestry and installation ownership facts.
 * @returns the permitted activation operation.
 */
export function classifyPreparedActivation(input: {
  currentIsAncestorTarget: boolean
  targetIsAncestorCurrent: boolean
  managed: boolean
}): 'fast-forward' | 'replace' | 'reject'

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
