/**
 * Match the configured GitHub repository without accepting lookalike remotes.
 * @param {string} remote - Git remote URL in HTTPS, SSH URL, or GitHub SCP form.
 * @param {string} repository - Expected owner/repository identity.
 * @returns {boolean} Whether the remote identifies the exact configured source.
 */
export function matchesUpdateRepository(remote, repository) {
  if (!/^[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(repository)) return false
  if (/[\s\\]/u.test(remote)) return false
  const scp = /^git@github\.com:(?<path>[^?#]+)$/i.exec(remote)
  const expected = repository.toLowerCase()
  if (scp !== null) return scp.groups.path.replace(/\.git$/i, '').toLowerCase() === expected
  let url
  try {
    url = new URL(remote)
  } catch {
    return false
  }
  if (url.hostname.toLowerCase() !== 'github.com' || url.search !== '' || url.hash !== '') return false
  if (url.password !== '') return false
  if (url.protocol === 'https:') {
    if (url.username !== '' || url.port !== '') return false
  } else if (url.protocol === 'ssh:') {
    if (url.username !== 'git' || (url.port !== '' && url.port !== '22')) return false
  } else {
    return false
  }
  return url.pathname.replace(/\.git$/i, '').toLowerCase() === `/${expected}`
}

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
