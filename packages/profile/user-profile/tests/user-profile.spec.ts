import { describe, expect, it } from 'vitest'
import {
  DEFAULT_USER_PROFILE_CONSENT,
  USER_PROFILE_LIMITS,
  deriveAge,
  mergeUserProfile,
  validateDateOfBirth,
  validateUserProfile,
  validateUserProfileUpdate,
} from '@deepseek-ai/dsh-user-profile'
import type { UserProfileSettings } from '@deepseek-ai/dsh-user-profile'

function consent(overrides: Partial<UserProfileSettings['consent']> = {}): UserProfileSettings['consent'] {
  return { ...DEFAULT_USER_PROFILE_CONSENT, ...overrides }
}

function profile(overrides: Partial<UserProfileSettings> = {}): UserProfileSettings {
  return {
    consent: consent(),
    ...overrides,
  }
}

function populatedProfile(): UserProfileSettings {
  return profile({
    fullName: 'Full Name',
    preferredName: 'Pref',
    dateOfBirth: '2000-04-10',
    gender: 'g',
    pronouns: 'p',
    profession: 'pro',
    organization: 'org',
    academicBackground: 'acad',
    country: 'DR',
    preferredLanguage: 'es',
    timezone: 'America/Santo_Domingo',
    technicalLevel: 'expert',
    responsePreferences: 'concise',
    tone: 'warm',
    family: [
      { relationship: 'spouse', name: 'D' },
      { relationship: 'child' },
    ],
  })
}

describe('user profile validation and projection helpers', () => {
  it('validates every populated profile field and a complete consent object', () => {
    expect(() => { validateUserProfile(populatedProfile()) }).not.toThrow()
    expect(() => { validateUserProfile(profile({ consent: consent() })) }).not.toThrow()
  })

  it('derives age across UTC birthday boundaries and supports the default current date', () => {
    expect(deriveAge('2000-04-10', new Date('2026-03-09T12:00:00.000Z'))).toBe(25)
    expect(deriveAge('2000-04-10', new Date('2026-04-09T12:00:00.000Z'))).toBe(25)
    expect(deriveAge('2000-04-10', new Date('2026-04-10T00:00:00.000Z'))).toBe(26)
    expect(deriveAge('2000-04-10', new Date('2026-05-01T00:00:00.000Z'))).toBe(26)
    expect(typeof deriveAge('2000-01-01')).toBe('number')
  })

  it('rejects malformed, impossible, future, and implausibly old dates while accepting valid dates', () => {
    expect(() => { validateDateOfBirth('2024/02/20', new Date('2026-01-01T00:00:00Z')) }).toThrow('YYYY-MM-DD')
    expect(() => { validateDateOfBirth('2024-02-30', new Date('2026-01-01T00:00:00Z')) }).toThrow('real calendar date')
    expect(() => { validateDateOfBirth('2027-01-01', new Date('2026-01-01T00:00:00Z')) }).toThrow('future')
    expect(() => { validateDateOfBirth('1800-01-01', new Date('2026-01-01T00:00:00Z')) }).toThrow('age limit')
    expect(() => { validateDateOfBirth('2000-12-31', new Date('2026-01-01T00:00:00Z')) }).not.toThrow()
    expect(() => { validateDateOfBirth('2000-01-01') }).not.toThrow()
  })

  it('enforces short and long text limits plus both control-character forms', () => {
    expect(() => { validateUserProfile(profile({ fullName: '   ' })) }).toThrow('cannot be empty')
    expect(() => { validateUserProfile(profile({ fullName: 'x'.repeat(USER_PROFILE_LIMITS.textCharacters + 1) })) }).toThrow('exceeds')
    expect(() => { validateUserProfile(profile({ academicBackground: 'x'.repeat(USER_PROFILE_LIMITS.longTextCharacters + 1) })) }).toThrow('exceeds')
    expect(() => { validateUserProfile(profile({ preferredName: 'bad\nname' })) }).toThrow('control character')
    expect(() => { validateUserProfile(profile({ preferredName: 'bad\u007fname' })) }).toThrow('control character')
  })

  it('validates named and unnamed family members and rejects invalid family bounds', () => {
    expect(() => {
      validateUserProfile(profile({ family: [{ relationship: 'spouse', name: 'D' }, { relationship: 'child' }] }))
    }).not.toThrow()
    expect(() => {
      validateUserProfile(profile({
        family: Array.from({ length: USER_PROFILE_LIMITS.familyMembers + 1 }, () => ({ relationship: 'x' })),
      }))
    }).toThrow('at most')
    expect(() => { validateUserProfile(profile({ family: [{ relationship: ' ' }] })) }).toThrow('cannot be empty')
    expect(() => { validateUserProfile(profile({ family: [{ relationship: 'child', name: ' ' }] })) }).toThrow('cannot be empty')
  })

  it('requires stored consent to be a plain complete boolean map with no unknown keys', () => {
    expect(() => { validateUserProfile({ consent: null } as unknown as UserProfileSettings) }).toThrow('consent must be an object')
    expect(() => {
      validateUserProfile({ consent: { ...consent(), fullName: 'yes' } } as unknown as UserProfileSettings)
    }).toThrow('consent.fullName must be boolean')
    expect(() => {
      validateUserProfile({ consent: { ...consent(), extra: true } } as unknown as UserProfileSettings)
    }).toThrow('unknown user profile consent field')
  })

  it('rejects non-plain updates, unknown keys, invalid scalar/family values, and invalid consent patches', () => {
    for (const value of [null, [], new Date(), 42, 'x']) {
      expect(() => { validateUserProfileUpdate(value) }).toThrow('plain object')
    }

    const nullPrototypeUpdate = Object.create(null) as Record<string, unknown>
    nullPrototypeUpdate.fullName = 'x'
    expect(() => { validateUserProfileUpdate(nullPrototypeUpdate) }).not.toThrow()

    expect(() => { validateUserProfileUpdate({ secret: 'x' }) }).toThrow('unknown user profile update field')
    expect(() => { validateUserProfileUpdate({ fullName: 1 }) }).toThrow('must be a string or null')
    expect(() => { validateUserProfileUpdate({ family: 'x' }) }).toThrow('family')
    expect(() => { validateUserProfileUpdate({ consent: null }) }).toThrow('update consent must be an object')
    expect(() => { validateUserProfileUpdate({ consent: { secret: true } }) }).toThrow('unknown user profile consent field')
    expect(() => { validateUserProfileUpdate({ consent: { fullName: 'yes' } }) }).toThrow('consent.fullName must be boolean')
    expect(() => {
      validateUserProfileUpdate({ fullName: 'x', preferredName: null, gender: undefined, family: [], consent: { fullName: true } })
    }).not.toThrow()
    expect(() => { validateUserProfileUpdate({}) }).not.toThrow()
  })

  it('merges values and consent without mutation while ignoring explicit undefined updates', () => {
    const current = populatedProfile()
    const original = structuredClone(current)
    const next = mergeUserProfile(current, {
      fullName: 'Changed',
      preferredName: undefined,
      family: [{ relationship: 'friend' }],
      consent: { fullName: true },
    })

    expect(next.fullName).toBe('Changed')
    expect(next.preferredName).toBe(original.preferredName)
    expect(next.family).toEqual([{ relationship: 'friend' }])
    expect(next.consent.fullName).toBe(true)
    expect(current).toEqual(original)
    expect(mergeUserProfile(current, {})).toEqual(current)
  })

  it('clears every optional profile field through null updates', () => {
    const fields = [
      'fullName',
      'preferredName',
      'dateOfBirth',
      'gender',
      'pronouns',
      'profession',
      'organization',
      'academicBackground',
      'country',
      'preferredLanguage',
      'timezone',
      'technicalLevel',
      'responsePreferences',
      'tone',
      'family',
    ] as const
    const patch = Object.fromEntries(fields.map(field => [field, null]))
    const next = mergeUserProfile(populatedProfile(), patch)
    for (const field of fields) expect(next).not.toHaveProperty(field)
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
