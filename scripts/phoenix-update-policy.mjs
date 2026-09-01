/**
 * Classify one stable-channel relation before the updater chooses an action.
 * A history replacement is limited to a managed release checkout; development
 * branches and unmanaged checkouts remain protected from automatic mutation.
 *
 * @param {{status: string, branch: string, managed: boolean, mode: string, stableBranch: string}} input - observed checkout and updater state.
 * @returns {'apply' | 'replace' | 'notify' | 'development' | 'pause' | 'unchanged'} the permitted watcher action.
 */
export function classifyStableUpdate({ status, branch, managed, mode, stableBranch }) {
  if (status !== 'upgrade' && status !== 'diverged') return 'unchanged'

  const releaseBranch = branch === 'main' || branch === stableBranch
  if (!releaseBranch) return status === 'upgrade' ? 'development' : 'pause'
  if (mode === 'notify') return 'notify'
  if (status === 'diverged') return managed ? 'replace' : 'pause'
  return 'apply'
}
