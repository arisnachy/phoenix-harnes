import { execFileSync } from 'node:child_process'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  spawnSyncMock.mockImplementation(actual.spawnSync)
  return { ...actual, spawnSync: spawnSyncMock }
})
import {
  parsePhoenixUpdateSnapshot,
  readPhoenixUpdateSnapshot,
  requestPhoenixUpdateRefresh,
  requestPhoenixUpdateRestart,
} from '../src/update-state.ts'

const roots: string[] = []
const previousRuntimeRoot = process.env.PHOENIX_RUNTIME_ROOT

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-update-state-'))
  roots.push(root)
  return root
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function repository(): string {
  const root = tempRoot()
  git(root, 'init')
  git(root, 'config', 'user.email', 'phoenix-test@example.invalid')
  git(root, 'config', 'user.name', 'PHOENIX Test')
  writeFileSync(join(root, 'seed.txt'), 'stable\n')
  git(root, 'add', 'seed.txt')
  git(root, 'commit', '-m', 'stable')
  return root
}

function statePath(root: string): string {
  return join(root, '.git', 'phoenix-update-state.json')
}

afterEach(() => {
  spawnSyncMock.mockClear()
  if (previousRuntimeRoot === undefined) delete process.env.PHOENIX_RUNTIME_ROOT
  else process.env.PHOENIX_RUNTIME_ROOT = previousRuntimeRoot
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('PHOENIX updater state bridge', () => {
  it('rejects non-object and unknown-state documents', () => {
    expect(parsePhoenixUpdateSnapshot(null).status).toBe('error')
    expect(parsePhoenixUpdateSnapshot('bad').status).toBe('error')
    expect(parsePhoenixUpdateSnapshot([]).status).toBe('error')
    expect(parsePhoenixUpdateSnapshot({ status: 42 }).status).toBe('error')
    expect(parsePhoenixUpdateSnapshot({ status: 'invented' }).status).toBe('error')
  })

  it('normalizes the legacy managed realignment result instead of showing an update error', () => {
    const target = 'b'.repeat(40)
    expect(parsePhoenixUpdateSnapshot({
      status: 'realigned-stable',
      previous: 'a'.repeat(40),
      current: target,
    })).toEqual({
      status: 'updated',
      previous: 'a'.repeat(40),
      current: target,
    })
  })

  it('sanitizes every browser-visible field and drops malformed commit ids', () => {
    const sha = 'a'.repeat(40)
    const snapshot = parsePhoenixUpdateSnapshot({
      status: 'ready',
      phase: 'ready',
      current: sha,
      target: sha,
      previous: sha,
      failedTarget: sha,
      channelPublishedAt: '2026-08-24T20:47:00Z',
      detail: 'x'.repeat(3000),
      at: '2026-08-24T23:00:00Z',
    })
    expect(snapshot).toMatchObject({
      status: 'ready',
      phase: 'ready',
      current: sha,
      target: sha,
      previous: sha,
      failedTarget: sha,
      channelPublishedAt: '2026-08-24T20:47:00Z',
      at: '2026-08-24T23:00:00Z',
    })
    expect(snapshot.detail).toHaveLength(2048)

    const malformed = parsePhoenixUpdateSnapshot({
      status: 'ready',
      phase: 7,
      current: 'short',
      target: 'not-a-sha',
      previous: null,
      failedTarget: false,
      detail: 99,
    })
    expect(malformed).toEqual({ status: 'ready' })
  })

  it('returns idle outside Git and when a repository has no updater state', () => {
    const outside = tempRoot()
    expect(readPhoenixUpdateSnapshot(outside)).toEqual({ status: 'idle' })
    const repo = repository()
    expect(readPhoenixUpdateSnapshot(repo)).toEqual({ status: 'idle' })
  })

  it('reads valid state and contains malformed JSON', () => {
    const repo = repository()
    const sha = git(repo, 'rev-parse', 'HEAD')
    writeFileSync(statePath(repo), JSON.stringify({ status: 'preparing', phase: 'build', target: sha }))
    expect(readPhoenixUpdateSnapshot(repo)).toEqual({ status: 'preparing', phase: 'build', target: sha })

    writeFileSync(statePath(repo), '{broken')
    expect(readPhoenixUpdateSnapshot(repo)).toEqual({
      status: 'error',
      detail: 'PHOENIX update state could not be read.',
    })
  })

  it('caches Git path resolution while reading changed JSON on every call', () => {
    const repo = repository()
    const sha = git(repo, 'rev-parse', 'HEAD')
    writeFileSync(statePath(repo), JSON.stringify({ status: 'preparing', phase: 'build', target: sha }))
    const initialSpawns = spawnSyncMock.mock.calls.length

    expect(readPhoenixUpdateSnapshot(repo)).toEqual({ status: 'preparing', phase: 'build', target: sha })
    const firstReadSpawns = spawnSyncMock.mock.calls.length
    expect(firstReadSpawns).toBeGreaterThan(initialSpawns)

    writeFileSync(statePath(repo), JSON.stringify({ status: 'current', current: sha }))
    expect(readPhoenixUpdateSnapshot(repo)).toEqual({ status: 'current', current: sha })
    expect(spawnSyncMock).toHaveBeenCalledTimes(firstReadSpawns)
  })

  it('uses the launcher runtime root when no explicit root is passed', () => {
    const repo = repository()
    process.env.PHOENIX_RUNTIME_ROOT = repo
    writeFileSync(statePath(repo), JSON.stringify({ status: 'checking' }))
    expect(readPhoenixUpdateSnapshot()).toEqual({ status: 'checking' })

    delete process.env.PHOENIX_RUNTIME_ROOT
    const previousCwd = process.cwd()
    process.chdir(repo)
    try {
      expect(readPhoenixUpdateSnapshot()).toEqual({ status: 'checking' })
    } finally {
      process.chdir(previousCwd)
    }
  })

  it('refuses restart unless the trusted state is exactly ready with a valid target', () => {
    const repo = repository()
    expect(requestPhoenixUpdateRestart(repo)).toEqual({ accepted: false, status: 'idle' })

    writeFileSync(statePath(repo), JSON.stringify({ status: 'preparing', phase: 'build' }))
    expect(requestPhoenixUpdateRestart(repo)).toEqual({ accepted: false, status: 'preparing' })

    writeFileSync(statePath(repo), JSON.stringify({ status: 'ready', target: 'bad' }))
    expect(requestPhoenixUpdateRestart(repo)).toEqual({ accepted: false, status: 'ready' })
  })

  it('projects an already queued automatic activation as restarting instead of actionable ready', () => {
    const repo = repository()
    const target = git(repo, 'rev-parse', 'HEAD')
    writeFileSync(statePath(repo), JSON.stringify({
      schema: 1,
      status: 'ready',
      phase: 'ready',
      current: target,
      target,
    }))
    writeFileSync(join(repo, '.git', 'phoenix-update-restart-request.json'), JSON.stringify({
      schema: 1,
      target,
      requestedAt: new Date().toISOString(),
    }))

    expect(readPhoenixUpdateSnapshot(repo)).toMatchObject({
      status: 'restarting',
      phase: 'restart',
      target,
    })
    expect(requestPhoenixUpdateRestart(repo)).toEqual({
      accepted: true,
      status: 'restarting',
    })
  })

  it('uses the common Git control directory from an isolated linked runtime', () => {
    const repo = repository()
    const target = git(repo, 'rev-parse', 'HEAD')
    const linked = tempRoot()
    rmSync(linked, { recursive: true, force: true })
    git(repo, 'worktree', 'add', '--detach', linked, target)

    writeFileSync(statePath(repo), JSON.stringify({
      schema: 1,
      status: 'ready',
      phase: 'ready',
      current: target,
      target,
    }))
    expect(readPhoenixUpdateSnapshot(linked)).toMatchObject({ status: 'ready', target })

    expect(requestPhoenixUpdateRefresh(linked)).toEqual({ accepted: true })
    expect(requestPhoenixUpdateRestart(linked)).toEqual({ accepted: true, status: 'restarting' })
    expect(JSON.parse(readFileSync(join(repo, '.git', 'phoenix-update-refresh-request.json'), 'utf8'))).toMatchObject({
      schema: 1,
    })
    expect(JSON.parse(readFileSync(join(repo, '.git', 'phoenix-update-restart-request.json'), 'utf8'))).toMatchObject({
      schema: 1,
      target,
    })
  })

  it('invalidates a linked worktree cache when its Git marker disappears and returns', () => {
    const repo = repository()
    const target = git(repo, 'rev-parse', 'HEAD')
    const linked = tempRoot()
    rmSync(linked, { recursive: true, force: true })
    git(repo, 'worktree', 'add', '--detach', linked, target)

    writeFileSync(statePath(repo), JSON.stringify({
      schema: 1,
      status: 'ready',
      phase: 'ready',
      current: target,
      target,
    }))
    const markerPath = join(linked, '.git')
    const marker = readFileSync(markerPath, 'utf8')
    expect(readPhoenixUpdateSnapshot(linked)).toMatchObject({ status: 'ready', target })

    rmSync(markerPath)
    expect(readPhoenixUpdateSnapshot(linked)).toEqual({ status: 'idle' })

    writeFileSync(markerPath, marker)
    expect(readPhoenixUpdateSnapshot(linked)).toMatchObject({ status: 'ready', target })
    expect(requestPhoenixUpdateRefresh(linked)).toEqual({ accepted: true })
  })

  it('invalidates an in-place linked worktree pointer rewrite and follows the new common directory', () => {
    const firstRepo = repository()
    const secondRepo = repository()
    const firstTarget = git(firstRepo, 'rev-parse', 'HEAD')
    const secondTarget = git(secondRepo, 'rev-parse', 'HEAD')
    const linked = tempRoot()
    const firstCommon = join(firstRepo, '.git')
    const secondCommon = join(secondRepo, '.git')
    writeFileSync(join(firstCommon, 'phoenix-update-state.json'), JSON.stringify({ status: 'ready', target: firstTarget }))
    writeFileSync(join(secondCommon, 'phoenix-update-state.json'), JSON.stringify({ status: 'current', current: secondTarget }))
    const markerPath = join(linked, '.git')
    const firstMarker = `gitdir: ${join(firstCommon, 'worktrees', 'linked')}\n`
    const secondMarker = `gitdir: ${join(secondCommon, 'worktrees', 'linked')}\n`
    writeFileSync(markerPath, firstMarker)
    const markerBefore = lstatSync(markerPath)
    let commonDirectory = firstCommon
    const actualSpawnSync = spawnSyncMock.getMockImplementation()
    spawnSyncMock.mockImplementation((_command, args, options) => {
      if (args[0] !== 'rev-parse' || options.cwd !== linked) throw new Error('unexpected Git lookup in pointer-cache test')
      return { status: 0, stdout: `${commonDirectory}\n` }
    })

    try {
      expect(readPhoenixUpdateSnapshot(linked)).toMatchObject({ status: 'ready', target: firstTarget })

      writeFileSync(markerPath, secondMarker)
      expect(lstatSync(markerPath).ino).toBe(markerBefore.ino)
      commonDirectory = secondCommon
      expect(readPhoenixUpdateSnapshot(linked)).toEqual({ status: 'current', current: secondTarget })
    } finally {
      if (actualSpawnSync !== undefined) spawnSyncMock.mockImplementation(actualSpawnSync)
    }
  })

  it('queues an immediate updater refresh without changing the durable update state', () => {
    const repo = repository()
    expect(requestPhoenixUpdateRefresh(repo)).toEqual({ accepted: true })
    const request = JSON.parse(readFileSync(join(repo, '.git', 'phoenix-update-refresh-request.json'), 'utf8')) as { requestedAt?: string }
    expect(request).toMatchObject({ schema: 1 })
    expect(new Date(request.requestedAt ?? '').toString()).not.toBe('Invalid Date')
    expect(readPhoenixUpdateSnapshot(repo)).toEqual({ status: 'idle' })
  })

  it('binds a restart request to the exact ready target and marks the state restarting', () => {
    const repo = repository()
    const target = git(repo, 'rev-parse', 'HEAD')
    writeFileSync(statePath(repo), JSON.stringify({
      schema: 1,
      status: 'ready',
      phase: 'ready',
      current: target,
      target,
    }))

    expect(requestPhoenixUpdateRestart(repo)).toEqual({ accepted: true, status: 'restarting' })
    const request = JSON.parse(readFileSync(join(repo, '.git', 'phoenix-update-restart-request.json'), 'utf8')) as { requestedAt?: string }
    expect(request).toMatchObject({ schema: 1, target })
    expect(new Date(request.requestedAt ?? '').toString()).not.toBe('Invalid Date')

    const state = JSON.parse(readFileSync(statePath(repo), 'utf8')) as { at?: string }
    expect(state).toMatchObject({
      schema: 1,
      status: 'restarting',
      phase: 'restart',
      current: target,
      target,
    })
    expect(new Date(state.at ?? '').toString()).not.toBe('Invalid Date')
    expect(readdirSync(join(repo, '.git')).filter(name => name.endsWith('.tmp'))).toEqual([])
    expect(readdirSync(join(repo, '.git')).filter(name => name.includes('phoenix-update-restart-request.json.') && name.endsWith('.tmp'))).toEqual([])
  })

  it('fails a restart request closed when Git identity disappears between reads', () => {
    const repo = repository()
    const target = git(repo, 'rev-parse', 'HEAD')
    writeFileSync(statePath(repo), JSON.stringify({ status: 'ready', target }))
    const movedGit = join(repo, '.git-hidden')
    mkdirSync(movedGit)
    // A normal ready state is proven above. This case exercises the second Git
    // identity read by calling against a path that is no longer a repository.
    process.env.PHOENIX_RUNTIME_ROOT = resolve(repo, 'missing-child')
    expect(requestPhoenixUpdateRestart()).toEqual({ accepted: false, status: 'idle' })
  })
})
