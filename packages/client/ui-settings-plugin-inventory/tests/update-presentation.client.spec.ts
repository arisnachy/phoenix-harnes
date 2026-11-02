import { describe, expect, it } from 'vitest'
import { activationNeedsVerification, isHiddenUpdaterPause, recentlyUpdated, updateStepLabelKey } from '../src/client/update-presentation.ts'

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

  it('warns for repeated restarts and an expired activation, not for a single valid restart', () => {
    const now = Date.parse('2026-10-24T23:55:00Z')
    const restart = (minutes: number) => ({
      step: 'restarting', result: 'started', at: new Date(now - minutes * 60_000).toISOString(),
    })
    expect(activationNeedsVerification({ status: 'restarting', events: [restart(1), restart(2), restart(3)] }, now)).toBe(true)
    expect(activationNeedsVerification({ status: 'restarting', events: [restart(1), restart(2)] }, now)).toBe(false)
    expect(activationNeedsVerification({ status: 'applying', at: new Date(now - 11 * 60_000).toISOString() }, now)).toBe(true)
    expect(activationNeedsVerification({ status: 'restarting', at: new Date(now - 2 * 60_000).toISOString() }, now)).toBe(false)
    expect(activationNeedsVerification({ status: 'restarting', at: 'invalid' }, now)).toBe(false)
    expect(activationNeedsVerification({ status: 'updated', events: [restart(1), restart(2), restart(3)] }, now)).toBe(false)
    expect(activationNeedsVerification({ status: 'restarting', events: [restart(16), restart(17), restart(18)] }, now)).toBe(false)
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
