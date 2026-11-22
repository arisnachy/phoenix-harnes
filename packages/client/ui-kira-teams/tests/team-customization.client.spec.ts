import { describe, expect, it } from 'vitest'
import { LIVING_TEAM_KINDS, normalizeTeamName } from '../src/client/team-customization.ts'

describe('Living Team identities', () => {
  it('has exactly Kira and her 20 stable specialist slots', () => {
    expect(LIVING_TEAM_KINDS.length).toBe(21)
    expect(new Set(LIVING_TEAM_KINDS).size).toBe(21)
    expect(LIVING_TEAM_KINDS[0]).toBe('kira')
  })
  it('normalizes user names but rejects executable markup and oversize labels', () => {
    expect(normalizeTeamName('  Senda    Mayor  ')).toBe('Senda Mayor')
    expect(normalizeTeamName('Órbita')).toBe('Órbita')
    expect(() => normalizeTeamName('<img src=x>')).toThrow()
    expect(() => normalizeTeamName('X'.repeat(49))).toThrow()
    expect(() => normalizeTeamName(' ')).toThrow()
  })
})
