/**
 * Return whether a checkout branch is managed by the PHOENIX release updater.
 * Keep this shared between preflight policy and prepared activation so a
 * promoted `stable` checkout cannot be prepared successfully and then rejected
 * by a stricter activation-only branch check.
 *
 * @param {string} branch - current checkout branch.
 * @param {string} stableBranch - configured promoted stable branch.
 * @returns {boolean} whether automatic release mutation is permitted.
 */
export function isManagedReleaseBranch(branch, stableBranch = 'stable') {
  return branch === 'main' || branch === stableBranch
}

/**
 * Select the safe Git operation for a prepared stable target.
 * A target behind the live checkout is never activated. An unrelated target
 * is accepted only when the caller has already established that the checkout
 * is a managed release installation.
 *
 * @param {{currentIsAncestorTarget: boolean, targetIsAncestorCurrent: boolean, managed: boolean}} input - Git ancestry and installation ownership facts.
 * @returns {'fast-forward' | 'replace' | 'reject'} the permitted activation operation.
 */
export function classifyPreparedActivation({ currentIsAncestorTarget, targetIsAncestorCurrent, managed }) {
  if (currentIsAncestorTarget) return 'fast-forward'
  if (targetIsAncestorCurrent) return 'reject'
  return managed ? 'replace' : 'reject'
}

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

  const releaseBranch = isManagedReleaseBranch(branch, stableBranch)
  if (!releaseBranch) return status === 'upgrade' ? 'development' : 'pause'
  if (mode === 'notify') return 'notify'
  if (status === 'diverged') return managed ? 'replace' : 'pause'
  return 'apply'
}
