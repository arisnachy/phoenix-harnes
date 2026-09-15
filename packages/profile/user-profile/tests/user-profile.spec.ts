import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ASSISTANT_GENDER,
  DEFAULT_ASSISTANT_NAME,
  DEFAULT_USER_PROFILE_CONSENT,
  deriveAge,
  mergeUserProfile,
  renderAssistantIdentity,
  validateDateOfBirth,
  validateUserProfile,
  validateUserProfileUpdate,
} from '@phoenix-ai/dsh-user-profile'
import type { UserProfileSettings } from '@phoenix-ai/dsh-user-profile'

function profile(overrides: Partial<UserProfileSettings> = {}): UserProfileSettings {
  return {
    assistantName: DEFAULT_ASSISTANT_NAME,
    assistantGender: DEFAULT_ASSISTANT_GENDER,
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

  it('keeps a configurable assistant identity with safe defaults', () => {
    const next = mergeUserProfile(profile(), {
      assistantName: 'Nova',
      assistantGender: 'feminine',
    })

    expect(next.assistantName).toBe('Nova')
    expect(next.assistantGender).toBe('feminine')
    expect(profile().assistantName).toBe('KIRA')
    expect(profile().assistantGender).toBe('neutral')
  })

  it('preserves configured assistant gender across unrelated profile updates', () => {
    const current = profile({
      assistantName: 'KIRA',
      assistantGender: 'feminine',
      preferredName: 'Arisnachy',
    })
    const next = mergeUserProfile(current, { tone: 'direct and warm' })

    expect(next.assistantName).toBe('KIRA')
    expect(next.assistantGender).toBe('feminine')
    expect(next.tone).toBe('direct and warm')
  })

  it('renders a stable human-presence contract without exposing orchestration', () => {
    const text = renderAssistantIdentity({ name: 'KIRA', gender: 'feminine' })

    expect(text).toContain('<phoenix_human_presence>')
    expect(text).toContain('Assistant gender presentation: feminine')
    expect(text).toContain('never replace a configured presentation with a provider default')
    expect(text).toContain('Learn from corrections and outcomes')
    expect(text).toContain('Keep internal machinery private during ordinary conversation')
    expect(text).toContain('Do not repeatedly remind the user that you are an AI')
  })

  it('keeps personal memory relevant and pending-work claims evidence-scoped', () => {
    const text = renderAssistantIdentity({ name: 'KIRA', gender: 'feminine' })

    expect(text).toContain('Treat personal profile and memory as private background context')
    expect(text).toContain('mention a family member, health detail, private preference, or other personal fact only when it is directly relevant')
    expect(text).toContain('For simple status, lookup, and review requests, retrieve first and lead with the result')
    expect(text).toContain('When the user asks what is pending')
    expect(text).toContain('Never claim that nothing else is pending unless every authoritative source in the intended scope was actually checked')
    expect(text).toContain('Do not turn unrelated memories into a menu of suggested topics')
  })

  it('rejects an assistant gender outside the supported presentation modes', () => {
    expect(() => { validateUserProfileUpdate({ assistantGender: 'robot' }) }).toThrow('assistantGender')
  })

  it('rejects unknown consent keys and control characters', () => {
    expect(() => { validateUserProfileUpdate({ consent: { secret: true } }) }).toThrow('unknown user profile consent field')
    expect(() => { validateUserProfile(profile({ preferredName: 'bad\nname' })) }).toThrow('control character')
  })
})
