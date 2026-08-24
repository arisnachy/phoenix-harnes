import { describe, expect, it } from 'vitest'
import {
  DEFAULT_USER_PROFILE_CONSENT,
  deriveAge,
  mergeUserProfile,
  validateDateOfBirth,
  validateUserProfile,
  validateUserProfileUpdate,
} from '@deepseek-ai/dsh-user-profile'
import type { UserProfileSettings } from '@deepseek-ai/dsh-user-profile'

function profile(overrides: Partial<UserProfileSettings> = {}): UserProfileSettings {
  return {
    consent: { ...DEFAULT_USER_PROFILE_CONSENT },
    ...overrides,
  }
}

describe('user profile validation and projection helpers', () => {
  it('derives age without persisting it and observes birthdays in UTC', () => {
    const beforeBirthday = new Date('2026-04-09T12:00:00.000Z')
    const onBirthday = new Date('2026-04-10T00:00:00.000Z')

    expect(deriveAge('2000-04-10', beforeBirthday)).toBe(25)
    expect(deriveAge('2000-04-10', onBirthday)).toBe(26)
  })

  it('rejects impossible, future, and implausibly old dates', () => {
    expect(() => { validateDateOfBirth('2024-02-30', new Date('2026-01-01T00:00:00Z')) }).toThrow('real calendar date')
    expect(() => { validateDateOfBirth('2027-01-01', new Date('2026-01-01T00:00:00Z')) }).toThrow('future')
    expect(() => { validateDateOfBirth('1800-01-01', new Date('2026-01-01T00:00:00Z')) }).toThrow('age limit')
  })

  it('merges consent and values without mutating the stored snapshot', () => {
    const current = profile({ preferredName: 'Ari' })
    const next = mergeUserProfile(current, {
      preferredName: 'Aris',
      consent: { preferredName: true },
    })

    expect(next.preferredName).toBe('Aris')
    expect(next.consent.preferredName).toBe(true)
    expect(current.preferredName).toBe('Ari')
    expect(current.consent.preferredName).toBe(false)
  })

  it('clears optional values through null updates', () => {
    const next = mergeUserProfile(profile({ preferredName: 'Aris' }), { preferredName: null })
    expect(next).not.toHaveProperty('preferredName')
  })

  it('rejects unknown consent keys and control characters', () => {
    expect(() => { validateUserProfileUpdate({ consent: { secret: true } }) }).toThrow('unknown user profile consent field')
    expect(() => { validateUserProfile(profile({ preferredName: 'bad\nname' })) }).toThrow('control character')
  })
})
