import { spawnSync } from 'node:child_process'

const SNAPSHOT_REF = 'refs/phoenix/recovery/worktree-snapshot'

function git(root, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  if (result.error !== undefined) {
    if (options.allowFailure) return { ok: false, stdout: '', stderr: result.error.message, status: 1 }
    throw result.error
  }
  const status = result.status ?? 1
  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : ''
  const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
  if (status !== 0 && !options.allowFailure) {
    throw new Error(`git ${args.join(' ')} failed (${String(status)})${stderr.length > 0 ? `: ${stderr}` : ''}`)
  }
  return { ok: status === 0, stdout, stderr, status }
}

function currentHead(root) {
  return git(root, ['rev-parse', 'HEAD']).stdout
}

function sameStatus(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index])
}

function assertSnapshotRef(root, snapshot) {
  if (!snapshot.dirty) return
  const ref = git(root, ['rev-parse', '--verify', '-q', SNAPSHOT_REF], { allowFailure: true })
  if (!ref.ok || ref.stdout !== snapshot.stash) {
    throw new Error('PHOENIX worktree snapshot recovery ref no longer matches the captured stash')
  }
}

function applySnapshot(root, snapshot) {
  assertSnapshotRef(root, snapshot)
  const result = git(root, ['stash', 'apply', '--index', snapshot.stash], { allowFailure: true })
  if (!result.ok) {
    const detail = result.stderr.length > 0 ? result.stderr : result.stdout
    throw new Error(`PHOENIX worktree snapshot restore failed${detail.length > 0 ? `: ${detail}` : ''}`)
  }
  const restored = worktreeStatus(root)
  if (!sameStatus(restored, snapshot.status)) {
    throw new Error('PHOENIX worktree snapshot restore did not reproduce the original Git status exactly')
  }
}

/**
 * Read the tracked, staged, and untracked state Git would preserve for an update transaction.
 * @param {string} root Repository root.
 * @returns {string[]} Porcelain-v1 status entries in Git order.
 */
export function worktreeStatus(root) {
  const output = git(root, ['status', '--porcelain=v1', '--untracked-files=all']).stdout
  return output.length === 0 ? [] : output.split(/\r?\n/u).filter(Boolean)
}

/**
 * Capture a dirty worktree in a pinned stash without including ignored dependency/build trees.
 * @param {string} root Repository root.
 * @returns {{dirty: false, head: string, status: string[]} | {dirty: true, head: string, status: string[], stash: string}} Recoverable snapshot metadata.
 */
export function captureWorktreeSnapshot(root) {
  const head = currentHead(root)
  const status = worktreeStatus(root)
  if (status.length === 0) return { dirty: false, head, status }

  const before = git(root, ['rev-parse', '--verify', '-q', 'refs/stash'], { allowFailure: true })
  const message = `PHOENIX transactional update ${new Date().toISOString()}`
  git(root, ['stash', 'push', '--include-untracked', '--message', message])
  const captured = git(root, ['rev-parse', '--verify', 'refs/stash'])
  if (captured.stdout.length === 0 || (before.ok && captured.stdout === before.stdout)) {
    throw new Error('PHOENIX could not create a distinct worktree snapshot before update activation')
  }

  git(root, ['update-ref', SNAPSHOT_REF, captured.stdout])
  const remaining = worktreeStatus(root)
  if (remaining.length > 0) {
    throw new Error(`PHOENIX worktree snapshot left ${String(remaining.length)} non-ignored change(s) outside the transaction`)
  }

  return { dirty: true, head, status, stash: captured.stdout }
}

/**
 * Restore a captured worktree over the currently checked-out commit and verify exact Git status.
 * @param {string} root Repository root.
 * @param {{dirty: boolean, head: string, status: string[], stash?: string}} snapshot Captured snapshot metadata.
 * @returns {void}
 */
export function restoreWorktreeSnapshot(root, snapshot) {
  if (!snapshot.dirty) return
  if (typeof snapshot.stash !== 'string' || snapshot.stash.length === 0) {
    throw new Error('PHOENIX worktree snapshot is missing its stash commit')
  }
  const current = worktreeStatus(root)
  if (current.length > 0) {
    throw new Error(`PHOENIX worktree snapshot restore requires a clean target checkout; found ${String(current.length)} change(s)`)
  }
  applySnapshot(root, snapshot)
}

/**
 * Return a failed activation to the captured HEAD and exact pre-update worktree state.
 * @param {string} root Repository root.
 * @param {{dirty: boolean, head: string, status: string[], stash?: string}} snapshot Captured snapshot metadata.
 * @returns {void}
 */
export function rollbackWorktreeSnapshot(root, snapshot) {
  git(root, ['reset', '--hard', snapshot.head])
  git(root, ['clean', '-fd'])

  if (snapshot.dirty) {
    if (typeof snapshot.stash !== 'string' || snapshot.stash.length === 0) {
      throw new Error('PHOENIX worktree rollback is missing its stash commit')
    }
    applySnapshot(root, snapshot)
  }

  const head = currentHead(root)
  if (head !== snapshot.head) {
    throw new Error(`PHOENIX worktree rollback restored HEAD ${head} instead of ${snapshot.head}`)
  }
  const restored = worktreeStatus(root)
  if (!sameStatus(restored, snapshot.status)) {
    throw new Error('PHOENIX worktree rollback did not reproduce the original Git status exactly')
  }
}

/**
 * Remove only the updater-owned stash and recovery ref after exact restoration has been verified.
 * @param {string} root Repository root.
 * @param {{dirty: boolean, head: string, status: string[], stash?: string}} snapshot Captured snapshot metadata.
 * @returns {void}
 */
export function finalizeWorktreeSnapshot(root, snapshot) {
  if (!snapshot.dirty) {
    git(root, ['update-ref', '-d', SNAPSHOT_REF], { allowFailure: true })
    return
  }
  if (typeof snapshot.stash !== 'string' || snapshot.stash.length === 0) {
    throw new Error('PHOENIX worktree snapshot is missing its stash commit')
  }

  assertSnapshotRef(root, snapshot)
  const list = git(root, ['stash', 'list', '--format=%H']).stdout
  const hashes = list.length === 0 ? [] : list.split(/\r?\n/u).filter(Boolean)
  const index = hashes.indexOf(snapshot.stash)
  if (index < 0) {
    throw new Error('PHOENIX worktree snapshot stash is no longer present; recovery ref retained')
  }

  git(root, ['stash', 'drop', `stash@{${String(index)}}`])
  git(root, ['update-ref', '-d', SNAPSHOT_REF, snapshot.stash])
}
