import { describe, expect, it } from 'vitest'
import { isHiddenUpdaterPause } from '../src/client/update-presentation.ts'

describe('updater presentation policy', () => {
  it('hides pauses caused by protected checkout policy', () => {
    expect(isHiddenUpdaterPause('development-branch')).toBe(true)
    expect(isHiddenUpdaterPause('diverged')).toBe(true)
    expect(isHiddenUpdaterPause('ahead')).toBe(true)
    expect(isHiddenUpdaterPause('foreign-remote')).toBe(true)
  })

  it('keeps unknown pauses visible while hiding local worktree protection', () => {
    expect(isHiddenUpdaterPause('worktree')).toBe(true)
    expect(isHiddenUpdaterPause('')).toBe(false)
    expect(isHiddenUpdaterPause(undefined)).toBe(false)
  })
})
