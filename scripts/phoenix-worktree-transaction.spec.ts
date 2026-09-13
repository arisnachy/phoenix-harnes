import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  captureWorktreeSnapshot,
  finalizeWorktreeSnapshot,
  restoreWorktreeSnapshot,
  rollbackWorktreeSnapshot,
  worktreeStatus,
} from './phoenix-worktree-transaction.mjs'

const repos: string[] = []

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-worktree-'))
  repos.push(root)
  git(root, 'init', '-b', 'main')
  git(root, 'config', 'user.email', 'phoenix-tests@example.invalid')
  git(root, 'config', 'user.name', 'PHOENIX Tests')
  writeFileSync(join(root, 'tracked.txt'), 'base tracked\n')
  writeFileSync(join(root, 'staged.txt'), 'base staged\n')
  writeFileSync(join(root, 'existing.txt'), 'base existing\n')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'base')
  return root
}

function head(root: string): string {
  return git(root, 'rev-parse', 'HEAD')
}

function stashHashes(root: string): string[] {
  const output = git(root, 'stash', 'list', '--format=%H')
  return output.length === 0 ? [] : output.split(/\r?\n/u).filter(Boolean)
}

afterEach(() => {
  while (repos.length > 0) rmSync(repos.pop()!, { recursive: true, force: true })
})

describe('PHOENIX dirty-worktree update transaction', () => {
  it('round-trips staged, unstaged, and untracked changes without disturbing an existing stash', () => {
    const root = createRepo()

    writeFileSync(join(root, 'existing.txt'), 'existing stash\n')
    git(root, 'stash', 'push', '--message', 'user stash')
    const existingStash = git(root, 'rev-parse', 'refs/stash')

    writeFileSync(join(root, 'tracked.txt'), 'local tracked\n')
    writeFileSync(join(root, 'staged.txt'), 'local staged\n')
    git(root, 'add', 'staged.txt')
    writeFileSync(join(root, 'untracked.txt'), 'local untracked\n')

    const snapshot = captureWorktreeSnapshot(root)
    expect(snapshot.dirty).toBe(true)
    expect(worktreeStatus(root)).toEqual([])

    writeFileSync(join(root, 'release.txt'), 'stable release\n')
    git(root, 'add', 'release.txt')
    git(root, 'commit', '-m', 'stable target')
    const target = head(root)

    restoreWorktreeSnapshot(root, snapshot)
    expect(head(root)).toBe(target)
    expect(worktreeStatus(root)).toEqual(snapshot.status)

    finalizeWorktreeSnapshot(root, snapshot)
    expect(stashHashes(root)).toEqual([existingStash])
    expect(git(root, 'rev-parse', '--verify', '-q', 'refs/phoenix/recovery/worktree-snapshot')).toBe('')
  })

  it('rolls a conflicting reapply back to the original head and exact worktree', () => {
    const root = createRepo()
    writeFileSync(join(root, 'tracked.txt'), 'local tracked\n')
    writeFileSync(join(root, 'staged.txt'), 'local staged\n')
    git(root, 'add', 'staged.txt')
    writeFileSync(join(root, 'untracked.txt'), 'local untracked\n')

    const snapshot = captureWorktreeSnapshot(root)
    const originalHead = snapshot.head

    writeFileSync(join(root, 'tracked.txt'), 'stable tracked\n')
    git(root, 'add', 'tracked.txt')
    git(root, 'commit', '-m', 'conflicting target')

    expect(() => restoreWorktreeSnapshot(root, snapshot)).toThrow(/restore/i)

    rollbackWorktreeSnapshot(root, snapshot)
    expect(head(root)).toBe(originalHead)
    expect(worktreeStatus(root)).toEqual(snapshot.status)
    expect(git(root, 'rev-parse', 'refs/phoenix/recovery/worktree-snapshot')).toBe(snapshot.stash)
  })
})
