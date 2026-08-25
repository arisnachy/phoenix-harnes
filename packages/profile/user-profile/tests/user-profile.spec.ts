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

  it('merges expanded profile fields and consent without mutating the stored snapshot', () => {
    const current = profile({ preferredName: 'Ari' })
    const next = mergeUserProfile(current, {
      fullName: 'Arisnachy Gomez Diaz',
      preferredName: 'Aris',
      profession: 'Physician and professor',
      country: 'Dominican Republic',
      preferredLanguage: 'es',
      timezone: 'America/Santo_Domingo',
      technicalLevel: 'expert',
      responsePreferences: 'Use rigorous, concise technical explanations.',
      consent: {
        preferredName: true,
        profession: true,
        preferredLanguage: true,
        technicalLevel: true,
      },
    })

    expect(next.fullName).toBe('Arisnachy Gomez Diaz')
    expect(next.preferredName).toBe('Aris')
    expect(next.profession).toBe('Physician and professor')
    expect(next.country).toBe('Dominican Republic')
    expect(next.timezone).toBe('America/Santo_Domingo')
    expect(next.consent.preferredName).toBe(true)
    expect(next.consent.profession).toBe(true)
    expect(current.preferredName).toBe('Ari')
    expect(current.consent.preferredName).toBe(false)
  })

  it('clears optional values through null updates', () => {
    const next = mergeUserProfile(profile({ preferredName: 'Aris', profession: 'Physician' }), {
      preferredName: null,
      profession: null,
    })
    expect(next).not.toHaveProperty('preferredName')
    expect(next).not.toHaveProperty('profession')
  })

  it('rejects unknown update and consent keys plus control characters', () => {
    expect(() => { validateUserProfileUpdate({ secret: 'x' }) }).toThrow('unknown user profile update field')
    expect(() => { validateUserProfileUpdate({ consent: { secret: true } }) }).toThrow('unknown user profile consent field')
    expect(() => { validateUserProfile(profile({ preferredName: 'bad\nname' })) }).toThrow('control character')
  })

  it('keeps every expanded consent field opt-in by default', () => {
    expect(Object.values(DEFAULT_USER_PROFILE_CONSENT).every(value => value === false)).toBe(true)
    expect(DEFAULT_USER_PROFILE_CONSENT).toMatchObject({
      fullName: false,
      profession: false,
      country: false,
      preferredLanguage: false,
      timezone: false,
      technicalLevel: false,
      responsePreferences: false,
    })
  })
})
