import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createSubagentWorktree,
  worktreeBranchName,
  worktreePathName,
} from '../src/index.ts'

const execFileAsync = promisify(execFile)
const cleanupRoots = new Set<string>()

afterEach(async () => {
  await Promise.all([...cleanupRoots].map(root => rm(root, { recursive: true, force: true })))
  cleanupRoots.clear()
})

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' })
  return stdout.trim()
}

async function repository(): Promise<{ root: string; repo: string }> {
  const root = await mkdtemp(join(tmpdir(), 'phoenix-worktree-test-'))
  cleanupRoots.add(root)
  const repo = join(root, 'repo')
  await mkdir(repo)
  await git(repo, ['init'])
  await git(repo, ['config', 'user.email', 'phoenix-test@example.invalid'])
  await git(repo, ['config', 'user.name', 'PHOENIX Test'])
  await writeFile(join(repo, 'seed.txt'), 'seed\n')
  await git(repo, ['add', 'seed.txt'])
  await git(repo, ['commit', '-m', 'seed'])
  return { root, repo }
}

describe('subagent worktree naming', () => {
  it('creates deterministic git-safe names from a session id', () => {
    expect(worktreeBranchName('child:abc/123')).toBe('phoenix/child-abc-123')
    expect(worktreePathName('child:abc/123')).toBe('child-abc-123')
  })

  it('rejects empty or punctuation-only identities', () => {
    expect(() => worktreeBranchName('')).toThrow(/session id/i)
    expect(() => worktreePathName('...')).toThrow(/git-safe/i)
  })
})

describe('subagent worktree lifecycle', () => {
  it('is a no-op outside a Git repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-non-git-'))
    cleanupRoots.add(root)
    await expect(createSubagentWorktree(root, 'child')).resolves.toBeUndefined()
  })

  it('creates an isolated checkout and removes only the clean worktree', async () => {
    const { repo } = await repository()
    const lease = await createSubagentWorktree(repo, 'child:clean')
    expect(lease).toBeDefined()
    if (lease === undefined) throw new Error('expected Git worktree lease')

    expect(lease.cwd).not.toBe(repo)
    await expect(readFile(join(lease.cwd, 'seed.txt'), 'utf8')).resolves.toBe('seed\n')
    expect(await git(lease.cwd, ['branch', '--show-current'])).toBe(lease.branch)

    await expect(lease.release()).resolves.toBe('removed-clean')
    await expect(access(lease.cwd)).rejects.toThrow()
    expect(await git(repo, ['branch', '--list', lease.branch])).toContain(lease.branch)
    await expect(lease.release()).resolves.toBe('already-gone')
  })

  it('preserves a dirty child checkout instead of deleting work', async () => {
    const { repo } = await repository()
    const lease = await createSubagentWorktree(repo, 'child:dirty')
    expect(lease).toBeDefined()
    if (lease === undefined) throw new Error('expected Git worktree lease')

    const dirty = join(lease.cwd, 'uncommitted.txt')
    await writeFile(dirty, 'keep me\n')
    await expect(lease.release()).resolves.toBe('preserved-dirty')
    await expect(readFile(dirty, 'utf8')).resolves.toBe('keep me\n')

    // Test cleanup is intentionally stronger than production teardown: the
    // assertion above proves production preserved the dirty checkout first.
    await git(repo, ['worktree', 'remove', '--force', lease.cwd])
  })
})
