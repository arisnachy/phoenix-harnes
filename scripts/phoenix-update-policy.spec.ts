import { describe, expect, it } from 'vitest'
import { classifyPreparedActivation, classifyStableUpdate, isManagedReleaseBranch } from './phoenix-update-policy.mjs'

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

  it('uses fast-forward activation for newer targets and rejects downgrades', () => {
    expect(classifyPreparedActivation({
      currentIsAncestorTarget: true,
      targetIsAncestorCurrent: false,
      managed: false,
    })).toBe('fast-forward')
    expect(classifyPreparedActivation({
      currentIsAncestorTarget: false,
      targetIsAncestorCurrent: true,
      managed: true,
    })).toBe('reject')
  })

  it('limits divergent prepared activation to managed installations', () => {
    expect(classifyPreparedActivation({
      currentIsAncestorTarget: false,
      targetIsAncestorCurrent: false,
      managed: true,
    })).toBe('replace')
    expect(classifyPreparedActivation({
      currentIsAncestorTarget: false,
      targetIsAncestorCurrent: false,
      managed: false,
    })).toBe('reject')
  })

  it('keeps an unmanaged or development checkout protected from source mutation', () => {
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
      supervised: false,
    })).toBe('development')
  })

  it('prepares an isolated runtime instead of blocking supervised development branches', () => {
    expect(classifyStableUpdate({
      status: 'upgrade',
      branch: 'kira/restart-function-fix',
      managed: false,
      mode: 'auto',
      stableBranch: 'stable',
      supervised: true,
    })).toBe('runtime')
    expect(classifyStableUpdate({
      status: 'diverged',
      branch: 'codex/work',
      managed: false,
      mode: 'auto',
      stableBranch: 'stable',
      supervised: true,
    })).toBe('runtime')
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