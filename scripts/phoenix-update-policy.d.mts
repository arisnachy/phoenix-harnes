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
