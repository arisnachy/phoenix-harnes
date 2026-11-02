import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-evolution-test-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function repository(root: string): string {
  const repo = join(root, 'runtime')
  mkdirSync(repo)
  git(repo, 'init')
  git(repo, 'config', 'user.email', 'phoenix-test@example.invalid')
  git(repo, 'config', 'user.name', 'PHOENIX Test')
  writeFileSync(join(repo, 'runtime.txt'), 'stable\n')
  git(repo, 'add', 'runtime.txt')
  git(repo, 'commit', '-m', 'stable')
  return repo
}

function run(repo: string, evolution: string) {
  return spawnSync(process.execPath, [resolve('scripts/phoenix-evolution-worktree.mjs')], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PHOENIX_EVOLUTION_ROOT: evolution },
  })
}

describe('phoenix-evolution-worktree', () => {
  it('creates a detached sibling worktree at the exact requested path', () => {
    const root = tempRoot()
    const repo = repository(root)
    const evolution = join(root, 'evolution')
    const result = run(repo, evolution)

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(resolve(evolution))
    expect(readFileSync(join(evolution, 'runtime.txt'), 'utf8')).toBe('stable\n')
    expect(git(evolution, 'branch', '--show-current')).toBe('')
  })

  it('reuses an existing worktree without destroying model edits', () => {
    const root = tempRoot()
    const repo = repository(root)
    const evolution = join(root, 'evolution')
    expect(run(repo, evolution).status).toBe(0)
    writeFileSync(join(evolution, 'runtime.txt'), 'model edit\n')

    const second = run(repo, evolution)
    expect(second.status).toBe(0)
    expect(readFileSync(join(evolution, 'runtime.txt'), 'utf8')).toBe('model edit\n')
  })

  it('fails closed when the requested evolution path is occupied by a normal directory', () => {
    const root = tempRoot()
    const repo = repository(root)
    const evolution = join(root, 'occupied')
    mkdirSync(evolution)

    const result = run(repo, evolution)
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('is not a Git worktree')
  })

  it('refuses to use the live runtime itself as the evolution root', () => {
    const root = tempRoot()
    const repo = repository(root)
    const result = run(repo, repo)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must be outside the live runtime')
  })
})
