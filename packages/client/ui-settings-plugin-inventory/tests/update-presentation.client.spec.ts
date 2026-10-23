import { describe, expect, it } from 'vitest'
import { isHiddenUpdaterPause, recentlyUpdated, updateStepLabelKey } from '../src/client/update-presentation.ts'

describe('updater presentation policy', () => {
  it('labels only allowlisted journal steps and recognizes a recent verified success', () => {
    expect(updateStepLabelKey('build')).toBe('updateStepBuild')
    expect(updateStepLabelKey('host-restart')).toBe('updateStepRestart')
    expect(updateStepLabelKey('powershell secret=XYZ')).toBeUndefined()
    const now = Date.parse('2026-10-23T19:00:00Z')
    const events = [{ step: 'updated', result: 'ok', at: new Date(now - 1000).toISOString() }]
    expect(recentlyUpdated(events, now)).toBe(true)
    expect(recentlyUpdated(events, now + 11 * 60_000)).toBe(false)
    expect(recentlyUpdated([{ step: 'updated', result: 'failed', at: events[0]!.at }], now)).toBe(false)
  })

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
