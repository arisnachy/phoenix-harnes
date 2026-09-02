import { describe, expect, it } from 'vitest'
import { classifyStableUpdate, isManagedReleaseBranch } from './phoenix-update-policy.mjs'

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
