import { spawnSync } from 'node:child_process'

/**
 * Check the real, promoted release pointer immediately before activating a
 * prepared runtime. Staging may have been valid hours ago but superseded after
 * its build. Never replace a healthy Phoenix with that stale runtime.
 *
 * A temporary network error fails closed: the current Host keeps serving, and
 * the existing watcher can retry. This does not touch user settings, profiles,
 * caches or Git branches.
 */
export function assertPromotedStableTarget(root, target, branch = 'stable', execute = spawnSync) {
  if (!/^[0-9a-f]{40}$/iu.test(target)) throw new Error('prepared Phoenix target is not a full Git SHA')
  if (!/^[a-z0-9][a-z0-9._/-]*$/iu.test(branch) || branch.includes('..')) {
    throw new Error('invalid Phoenix stable branch')
  }
  const result = execute('git', ['ls-remote', '--heads', 'origin', branch], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 7000,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'Never',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error !== undefined || result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error(
      'could not verify latest stable release; retaining current Phoenix instead of activating an unverified older runtime',
    )
  }
  const suffix = `refs/heads/${branch}`
  const row = result.stdout.split(/\r?\n/u).find(line => line.trim().endsWith(suffix))
  const promoted = row?.trim().split(/\s+/u)[0]
  if (promoted === undefined || !/^[0-9a-f]{40}$/iu.test(promoted)) {
    throw new Error('stable channel returned no valid release SHA; retaining current Phoenix')
  }
  if (promoted.toLowerCase() !== target.toLowerCase()) {
    throw new Error(
      `prepared Phoenix ${target.slice(0, 12)} is stale; stable now points to ${promoted.slice(0, 12)}. Discarding old restart request.`,
    )
  }
  return promoted
}
