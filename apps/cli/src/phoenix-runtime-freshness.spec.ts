import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clientArtifactsAreFresh,
  preparePhoenixWebRuntime,
  sourceCheckoutSupersedesRuntime,
} from './phoenix-runtime-freshness.ts'

const roots: string[] = []

function git(root: string, args: readonly string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-runtime-freshness-'))
  roots.push(root)
  git(root, ['init'])
  git(root, ['config', 'user.email', 'phoenix-tests@example.invalid'])
  git(root, ['config', 'user.name', 'PHOENIX Tests'])
  writeFileSync(join(root, '.gitignore'), '.dsh-build/\napps/web/dist/\n', 'utf8')
  writeFileSync(join(root, 'state.txt'), 'one\n', 'utf8')
  git(root, ['add', '.gitignore', 'state.txt'])
  git(root, ['commit', '-m', 'initial'])
  return root
}

function advance(root: string): { readonly target: string, readonly head: string } {
  const target = git(root, ['rev-parse', 'HEAD'])
  writeFileSync(join(root, 'state.txt'), 'two\n', 'utf8')
  git(root, ['add', 'state.txt'])
  git(root, ['commit', '-m', 'advance'])
  return { target, head: git(root, ['rev-parse', 'HEAD']) }
}

function writeFreshClientArtifacts(root: string, head: string): void {
  mkdirSync(join(root, '.dsh-build'), { recursive: true })
  mkdirSync(join(root, 'apps', 'web', 'dist'), { recursive: true })
  writeFileSync(join(root, 'apps', 'web', 'dist', 'index.html'), '<!doctype html>\n', 'utf8')
  writeFileSync(join(root, '.dsh-build', 'client-build-environment.json'), JSON.stringify({
    environment: { DSH_CLIENT_COMMIT_HASH: head.slice(0, 7) },
  }), 'utf8')
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

describe('PHOENIX runtime freshness', () => {
  it('prefers a clean source checkout when it has advanced beyond the isolated runtime target', () => {
    const root = repository()
    const { target, head } = advance(root)

    expect(sourceCheckoutSupersedesRuntime(root, target, head)).toBe(true)
  })

  it('keeps the isolated runtime while the source checkout contains local work', () => {
    const root = repository()
    const { target, head } = advance(root)
    writeFileSync(join(root, 'local.txt'), 'protected user work\n', 'utf8')

    expect(sourceCheckoutSupersedesRuntime(root, target, head)).toBe(false)
  })

  it('recognizes client artifacts only when both the build record and web bundle match the source commit', () => {
    const root = repository()
    const head = git(root, ['rev-parse', 'HEAD'])
    writeFreshClientArtifacts(root, head)

    expect(clientArtifactsAreFresh(root, head)).toBe(true)

    writeFileSync(join(root, '.dsh-build', 'client-build-environment.json'), JSON.stringify({
      environment: { DSH_CLIENT_COMMIT_HASH: '0000000' },
    }), 'utf8')
    expect(clientArtifactsAreFresh(root, head)).toBe(false)
  })

  it('retires the stale isolated runtime marker before launch when the clean source is newer', () => {
    const root = repository()
    const { target, head } = advance(root)
    writeFreshClientArtifacts(root, head)
    const gitDir = git(root, ['rev-parse', '--git-dir'])
    const marker = resolve(root, gitDir, 'phoenix-active-runtime.json')
    writeFileSync(marker, JSON.stringify({
      schema: 1,
      target,
      path: join(root, 'old-runtime'),
    }), 'utf8')

    expect(existsSync(marker)).toBe(true)
    preparePhoenixWebRuntime(root)
    expect(existsSync(marker)).toBe(false)
  })
})
