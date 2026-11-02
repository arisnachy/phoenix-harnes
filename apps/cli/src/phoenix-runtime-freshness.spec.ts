import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clientArtifactsAreFresh,
  missingHostRuntimeArtifacts,
  phoenixSupervisorSourceRoot,
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
  mkdirSync(join(root, 'apps', 'cli', 'lib'), { recursive: true })
  mkdirSync(join(root, 'scripts'), { recursive: true })
  writeFileSync(join(root, 'apps', 'cli', 'package.json'), JSON.stringify({ name: '@phoenix-ai/dsh' }), 'utf8')
  writeFileSync(join(root, 'apps', 'cli', 'lib', 'bin.js'), '', 'utf8')
  writeFileSync(join(root, 'scripts', 'phoenix-windows-supervisor.mjs'), '// supervisor\n', 'utf8')
  writeFileSync(join(root, 'scripts', 'phoenix-update-live-command.mjs'), '// verified release helper\n', 'utf8')
  git(root, ['add', '.gitignore', 'state.txt', 'apps/cli/package.json', 'apps/cli/lib/bin.js',
    'scripts/phoenix-windows-supervisor.mjs', 'scripts/phoenix-update-live-command.mjs'])
  git(root, ['commit', '-m', 'initial'])
  return root
}

function advance(root: string): { readonly target: string; readonly head: string } {
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
  // This isolated fixture has precisely one client artifact.
  const file = 'apps/web/dist/index.html'
  const body = readFileSync(join(root, file))
  const digest = createHash('sha256')
    .update(`${Buffer.byteLength(file)}:`)
    .update(file)
    .update(`${body.byteLength}:`)
    .update(body)
    .digest('hex')
  writeFileSync(join(root, '.dsh-build', 'client-build-environment.json'), JSON.stringify({
    formatVersion: 1,
    environment: { DSH_CLIENT_COMMIT_HASH: head.slice(0, 7) },
    artifacts: { fileCount: 1, sha256: digest },
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

  it('prefers a newer checkout despite local work without deleting those edits', () => {
    const root = repository()
    const { target, head } = advance(root)
    const local = join(root, 'local.txt')
    writeFileSync(local, 'protected user work\n', 'utf8')

    expect(sourceCheckoutSupersedesRuntime(root, target, head)).toBe(true)
    writeFreshClientArtifacts(root, head)
    const marker = resolve(root, git(root, ['rev-parse', '--git-dir']), 'phoenix-active-runtime.json')
    writeFileSync(marker, JSON.stringify({ schema: 1, target, path: join(root, 'old-runtime') }), 'utf8')

    preparePhoenixWebRuntime(root)
    expect(existsSync(marker)).toBe(false)
    expect(readFileSync(local, 'utf8')).toBe('protected user work\n')
  })

  it('recognizes client artifacts only when both the build record and web bundle match the source commit', () => {
    const root = repository()
    const head = git(root, ['rev-parse', 'HEAD'])
    writeFreshClientArtifacts(root, head)

    expect(clientArtifactsAreFresh(root, head)).toBe(true)

    // A recorded commit alone must not allow damaged/old browser assets.
    writeFileSync(join(root, 'apps', 'web', 'dist', 'index.html'), '<!doctype html>old blue UI</html>', 'utf8')
    expect(clientArtifactsAreFresh(root, head)).toBe(false)
    writeFreshClientArtifacts(root, head)
    expect(clientArtifactsAreFresh(root, head)).toBe(true)

    writeFileSync(join(root, '.dsh-build', 'client-build-environment.json'), JSON.stringify({
      environment: { DSH_CLIENT_COMMIT_HASH: '0000000' },
    }), 'utf8')
    expect(clientArtifactsAreFresh(root, head)).toBe(false)
  })

  it('detects a missing Host package artifact through the CLI dependency closure', () => {
    const root = repository()
    mkdirSync(join(root, 'apps', 'cli', 'lib'), { recursive: true })
    writeFileSync(join(root, 'apps', 'cli', 'lib', 'bin.js'), '', 'utf8')
    writeFileSync(join(root, 'apps', 'cli', 'package.json'), JSON.stringify({
      name: '@phoenix-ai/dsh',
      dependencies: { '@phoenix-ai/dsh-base': 'workspace:^' },
    }), 'utf8')

    const base = join(root, 'packages', 'bundle', 'base')
    mkdirSync(base, { recursive: true })
    writeFileSync(join(base, 'package.json'), JSON.stringify({
      name: '@phoenix-ai/dsh-base',
      main: 'lib/index.js',
      dependencies: { '@phoenix-ai/dsh-tool-google-workspace': 'workspace:^' },
    }), 'utf8')
    mkdirSync(join(base, 'lib'), { recursive: true })
    writeFileSync(join(base, 'lib', 'index.js'), '', 'utf8')

    const google = join(root, 'packages', 'credentials', 'tool-google-workspace')
    mkdirSync(google, { recursive: true })
    writeFileSync(join(google, 'package.json'), JSON.stringify({
      name: '@phoenix-ai/dsh-tool-google-workspace',
      main: 'lib/index.js',
    }), 'utf8')

    expect(missingHostRuntimeArtifacts(root))
      .toContain('packages/credentials/tool-google-workspace/lib/index.js')

    mkdirSync(join(google, 'lib'), { recursive: true })
    writeFileSync(join(google, 'lib', 'index.js'), '', 'utf8')
    expect(missingHostRuntimeArtifacts(root)).toEqual([])
  })

  it('loads Windows supervisor code from the verified active runtime when the durable checkout is protected', () => {
    const root = repository()
    const target = git(root, ['rev-parse', 'HEAD'])
    const holder = mkdtempSync(join(tmpdir(), 'phoenix-active-supervisor-'))
    roots.push(holder)
    const runtime = join(holder, 'runtime')
    git(root, ['worktree', 'add', '--detach', runtime, target])

    const gitDir = git(root, ['rev-parse', '--git-dir'])
    writeFileSync(resolve(root, gitDir, 'phoenix-active-runtime.json'), JSON.stringify({
      schema: 1,
      target,
      path: runtime,
    }), 'utf8')

    writeFileSync(join(root, 'protected-local-work.txt'), 'do not touch\n', 'utf8')

    expect(phoenixSupervisorSourceRoot(root)).toBe(resolve(runtime))
  })

  it('restores only an absent helper from verified old runtime HEAD before launching its supervisor', () => {
    const root = repository()
    const target = git(root, ['rev-parse', 'HEAD'])
    const holder = mkdtempSync(join(tmpdir(), 'phoenix-missing-live-helper-'))
    roots.push(holder)
    const runtime = join(holder, 'old-runtime')
    git(root, ['worktree', 'add', '--detach', runtime, target])
    const helper = join(runtime, 'scripts', 'phoenix-update-live-command.mjs')
    rmSync(helper)
    const gitDir = git(root, ['rev-parse', '--git-dir'])
    writeFileSync(resolve(root, gitDir, 'phoenix-active-runtime.json'), JSON.stringify({
      schema: 1, target, path: runtime,
    }), 'utf8')
    const protectedFile = join(root, 'my-uncommitted-changes.txt')
    writeFileSync(protectedFile, 'do not overwrite\n', 'utf8')

    expect(existsSync(helper)).toBe(false)
    expect(phoenixSupervisorSourceRoot(root)).toBe(resolve(runtime))
    expect(readFileSync(helper, 'utf8')).toBe('// verified release helper\n')
    expect(git(runtime, ['status', '--porcelain'])).toBe('')
    expect(readFileSync(protectedFile, 'utf8')).toBe('do not overwrite\n')
  })

  it('never overwrites a present helper even if its local contents were edited', () => {
    const root = repository()
    const target = git(root, ['rev-parse', 'HEAD'])
    const holder = mkdtempSync(join(tmpdir(), 'phoenix-custom-live-helper-'))
    roots.push(holder)
    const runtime = join(holder, 'custom-runtime')
    git(root, ['worktree', 'add', '--detach', runtime, target])
    const helper = join(runtime, 'scripts', 'phoenix-update-live-command.mjs')
    writeFileSync(helper, '// preserve custom contents\n', 'utf8')
    const gitDir = git(root, ['rev-parse', '--git-dir'])
    writeFileSync(resolve(root, gitDir, 'phoenix-active-runtime.json'), JSON.stringify({
      schema: 1, target, path: runtime,
    }), 'utf8')

    expect(phoenixSupervisorSourceRoot(root)).toBe(resolve(runtime))
    expect(readFileSync(helper, 'utf8')).toBe('// preserve custom contents\n')
  })

  it('falls back to durable supervisor code when the active runtime marker is not verifiable', () => {
    const root = repository()
    const target = git(root, ['rev-parse', 'HEAD'])
    const gitDir = git(root, ['rev-parse', '--git-dir'])
    writeFileSync(resolve(root, gitDir, 'phoenix-active-runtime.json'), JSON.stringify({
      schema: 1,
      target,
      path: join(root, 'missing-runtime'),
    }), 'utf8')

    expect(phoenixSupervisorSourceRoot(root)).toBe(resolve(root))
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
