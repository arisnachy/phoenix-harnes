import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { classifyStableUpdate, isManagedReleaseBranch, matchesUpdateRepository } from './phoenix-update-policy.mjs'

describe('update repository identity', () => {
  it('rejects a lookalike during prepared activation without consuming the request or changing refs', () => {
    const root = mkdtempSync(join(tmpdir(), 'phoenix-activation-rejection-'))
    try {
      execFileSync('git', ['init', '--initial-branch=main', root], { stdio: 'pipe' })
      execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/arisnachy/phoenix-harnes-evil.git'], {
        cwd: root, stdio: 'pipe',
      })
      const target = 'a'.repeat(40)
      const requestPath = join(root, '.git', 'phoenix-update-restart-request.json')
      const preparedPath = join(root, '.git', 'phoenix-update-prepared.json')
      const request = JSON.stringify({ schema: 1, target })
      const prepared = JSON.stringify({ schema: 1, target, base: 'b'.repeat(40), mode: 'none' })
      writeFileSync(requestPath, request)
      writeFileSync(preparedPath, prepared)
      const before = execFileSync('git', ['for-each-ref', '--format=%(refname) %(objectname)'], { cwd: root, encoding: 'utf8' })
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('phoenix-activate-prepared.mjs', import.meta.url))], {
        cwd: root, encoding: 'utf8', timeout: 10_000, windowsHide: true,
        env: { ...process.env, PHOENIX_UPDATE_REMOTE: 'origin', PHOENIX_UPDATE_REPOSITORY: 'arisnachy/phoenix-harnes' },
      })
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('configured remote origin is not the official PHOENIX repository')
      expect(readFileSync(requestPath, 'utf8')).toBe(request)
      expect(readFileSync(preparedPath, 'utf8')).toBe(prepared)
      expect(existsSync(join(root, '.git', 'phoenix-update-state.json'))).toBe(false)
      expect(execFileSync('git', ['for-each-ref', '--format=%(refname) %(objectname)'], { cwd: root, encoding: 'utf8' })).toBe(before)
      expect(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })).toBe('')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each(['phoenix-managed-update.mjs', 'phoenix-auto-update.mjs'])('rejects a lookalike before any fetch in %s', (script) => {
    const root = mkdtempSync(join(tmpdir(), 'phoenix-remote-rejection-'))
    try {
      execFileSync('git', ['init', '--initial-branch=main', root], { stdio: 'pipe' })
      execFileSync('git', ['remote', 'add', 'origin', 'http://127.0.0.1:9/github.com/arisnachy/phoenix-harnes'], {
        cwd: root, stdio: 'pipe',
      })
      writeFileSync(join(root, '.phoenix-managed-install'), '')
      const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), '--check'], {
        cwd: root, encoding: 'utf8', timeout: 10_000, windowsHide: true,
        env: {
          ...process.env, PHOENIX_AUTO_UPDATE: '1', PHOENIX_UPDATE_MODE: 'auto',
          PHOENIX_UPDATE_REMOTE: 'origin', PHOENIX_UPDATE_REPOSITORY: 'arisnachy/phoenix-harnes',
        },
      })
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(0)
      expect(result.stderr).toContain('is not the official arisnachy/phoenix-harnes repository')
      expect(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim())
        .toBe('?? .phoenix-managed-install')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each([
    'https://github.com/arisnachy/phoenix-harnes.git',
    'https://github.com/ARISNACHY/PHOENIX-HARNES',
    'git@github.com:arisnachy/phoenix-harnes.git',
    'ssh://git@github.com/arisnachy/phoenix-harnes.git',
  ])('accepts the configured GitHub repository: %s', (remote) => {
    expect(matchesUpdateRepository(remote, 'arisnachy/phoenix-harnes')).toBe(true)
  })

  it.each([
    'https://github.com/arisnachy/phoenix-harnes-evil.git',
    'https://evil.example/github.com/arisnachy/phoenix-harnes',
    'https://github.com.evil.example/arisnachy/phoenix-harnes',
    'https://github.com@evil.example/arisnachy/phoenix-harnes',
    'https://github.com/arisnachy/phoenix-harnes/other',
    'https://github.com/arisnachy/phoenix-harnes?other=1',
    'https://github.com/arisnachy/phoenix-harnes#other',
    'http://github.com/arisnachy/phoenix-harnes',
    'file:///github.com/arisnachy/phoenix-harnes',
    'https://github.com:8443/arisnachy/phoenix-harnes',
    'git@github.com:arisnachy/phoenix-harnes-evil.git',
    'not a URL',
  ])('rejects a different or ambiguous remote: %s', (remote) => {
    expect(matchesUpdateRepository(remote, 'arisnachy/phoenix-harnes')).toBe(false)
  })
})

describe('PHOENIX stable update policy', () => {
  it('uses one release-branch contract for main, stable, and development checkouts', () => {
    expect(isManagedReleaseBranch('main', 'stable')).toBe(true)
    expect(isManagedReleaseBranch('stable', 'stable')).toBe(true)
    expect(isManagedReleaseBranch('release', 'release')).toBe(true)
    expect(isManagedReleaseBranch('codex/work', 'stable')).toBe(false)
    expect(isManagedReleaseBranch('', 'stable')).toBe(false)
  })

  it('allows a clean managed stable checkout to replace unrelated release history', () => {
    expect(classifyStableUpdate({
      status: 'diverged',
      branch: 'stable',
      managed: true,
      mode: 'auto',
      stableBranch: 'stable',
    })).toBe('replace')
  })

  it('keeps an unmanaged or development checkout protected', () => {
    expect(classifyStableUpdate({
      status: 'diverged',
      branch: 'stable',
      managed: false,
      mode: 'auto',
      stableBranch: 'stable',
    })).toBe('pause')
    expect(classifyStableUpdate({
      status: 'upgrade',
      branch: 'codex/work',
      managed: true,
      mode: 'auto',
      stableBranch: 'stable',
    })).toBe('development')
  })

  it('reports a managed replacement without mutating in notify mode', () => {
    expect(classifyStableUpdate({
      status: 'diverged',
      branch: 'stable',
      managed: true,
      mode: 'notify',
      stableBranch: 'stable',
    })).toBe('notify')
  })
})
