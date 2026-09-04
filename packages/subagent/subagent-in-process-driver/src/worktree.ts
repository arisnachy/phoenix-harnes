/** Git-worktree isolation for parallel in-process subagents. */

import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

const GIT_MAX_BUFFER = 1024 * 1024

/** Worktree teardown outcome; dirty work is deliberately preserved. */
export type WorktreeReleaseResult = 'removed-clean' | 'preserved-dirty' | 'already-gone'

/** One isolated child checkout leased from the parent Git repository. */
export interface SubagentWorktreeLease {
  readonly cwd: string
  readonly branch: string
  readonly repositoryRoot: string
  release(): Promise<WorktreeReleaseResult>
}

/** Convert an opaque session id into one deterministic Git/path-safe slug. */
function safeIdentity(sessionId: string): string {
  const value = sessionId.trim()
  if (value === '') throw new Error('subagent worktree requires a non-empty session id')
  const slug = value
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^[.-]+|[.-]+$/gu, '')
  if (slug === '') throw new Error('subagent worktree session id contains no Git-safe characters')
  return slug
}

/**
 * Return the branch namespace owned by one PHOENIX subagent worktree.
 * @param sessionId - Opaque child session identity to normalize.
 * @returns Deterministic Git branch name under the `phoenix/` namespace.
 */
export function worktreeBranchName(sessionId: string): string {
  return `phoenix/${safeIdentity(sessionId)}`
}

/**
 * Return the filesystem leaf owned by one PHOENIX subagent worktree.
 * @param sessionId - Opaque child session identity to normalize.
 * @returns Deterministic path-safe worktree leaf.
 */
export function worktreePathName(sessionId: string): string {
  return safeIdentity(sessionId)
}

/** Run Git without invoking a shell, preserving argv boundaries on every OS. */
function git(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer: GIT_MAX_BUFFER, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error !== null) {
        const detail = stderr.trim()
        reject(new Error(detail === '' ? `git ${args.join(' ')} failed` : detail, { cause: error }))
        return
      }
      resolve(stdout.trim())
    })
  })
}

/** Discover the primary checkout root shared by linked worktrees. */
async function discoverRepositoryRoot(cwd: string): Promise<string | undefined> {
  let commonDir: string
  try {
    commonDir = await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  } catch {
    // A non-Git workspace needs no Git isolation. This also keeps PHOENIX
    // usable on machines where Git is intentionally absent.
    return undefined
  }
  const normalized = commonDir.replace(/[\\/]+$/u, '')
  return basename(normalized) === '.git' ? dirname(normalized) : undefined
}

/**
 * Create an isolated Git worktree for a child. Non-Git workspaces return
 * `undefined`; once a repository is discovered, creation errors are fatal so
 * requested isolation never silently degrades into shared writes.
 * @param parentCwd - Parent session working directory, when one is known.
 * @param sessionId - Child session identity used for branch and path naming.
 * @returns A releasable worktree lease, or `undefined` outside Git workspaces.
 */
export async function createSubagentWorktree(
  parentCwd: string | undefined,
  sessionId: string,
): Promise<SubagentWorktreeLease | undefined> {
  if (parentCwd === undefined) return undefined
  const repositoryRoot = await discoverRepositoryRoot(parentCwd)
  if (repositoryRoot === undefined) return undefined

  const leaf = worktreePathName(sessionId)
  const branch = worktreeBranchName(sessionId)
  const pool = join(dirname(repositoryRoot), '.phoenix-worktrees', basename(repositoryRoot))
  const cwd = join(pool, leaf)
  await mkdir(pool, { recursive: true })
  await git(parentCwd, ['worktree', 'add', '-b', branch, cwd, 'HEAD'])

  let released = false
  return {
    cwd,
    branch,
    repositoryRoot,
    async release(): Promise<WorktreeReleaseResult> {
      if (released) return 'already-gone'
      let status: string
      try {
        status = await git(cwd, ['status', '--porcelain', '--untracked-files=normal'])
      } catch {
        released = true
        return 'already-gone'
      }
      if (status !== '') return 'preserved-dirty'
      await git(repositoryRoot, ['worktree', 'remove', cwd])
      // Keep the branch even when the worktree is clean: a child may have
      // committed useful work, and deleting that ref would make teardown
      // destructive. A later maintenance policy may prune merged branches.
      released = true
      return 'removed-clean'
    },
  }
}
