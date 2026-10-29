import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ASSISTANT_GENDER,
  DEFAULT_ASSISTANT_NAME,
  DEFAULT_USER_PROFILE_CONSENT,
  deriveAge,
  inferAssistantGenderFromUserMessage,
  mergeUserProfile,
  projectConsentedProfile,
  renderConsentedProfile,
  renderAssistantIdentity,
  renderHumanConnection,
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

  it('uses professional addressing only for fields with explicit consent', () => {
    const configured = mergeUserProfile(profile(), {
      preferredName: 'Aris', profession: 'Médico', professionalTitle: 'Doctor',
      addressingMode: 'title', consent: { preferredName: true, profession: true, professionalTitle: true },
    })
    const allowed = projectConsentedProfile(configured)
    expect(allowed).toMatchObject({ preferredName: 'Aris', profession: 'Médico', professionalTitle: 'Doctor', addressingMode: 'title' })
    expect(renderConsentedProfile(allowed)).toContain('use the professional title occasionally')

    const withdrawn = projectConsentedProfile({
      ...configured, consent: { ...configured.consent, profession: false, professionalTitle: false },
    })
    const context = renderConsentedProfile(withdrawn)
    expect(context).not.toContain('Médico')
    expect(context).not.toContain('Doctor')
    expect(context).toContain('not authorized; use neutral wording')
  })

  it('respects no address and rejects unrecognized addressing modes', () => {
    const noAddress = mergeUserProfile(profile(), { addressingMode: 'none' })
    expect(renderConsentedProfile(projectConsentedProfile(noAddress))).toContain('never use a personal name or title')
    expect(() => { validateUserProfileUpdate({ addressingMode: 'nickname' }) }).toThrow('addressingMode')
    expect(mergeUserProfile(noAddress, { addressingMode: null }).addressingMode).toBeUndefined()
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
    expect(profile().assistantGender).toBe('feminine')
  })

  it('preserves configured assistant gender and provenance across unrelated profile updates', () => {
    const current = profile({
      assistantName: 'KIRA',
      assistantGender: 'feminine',
      assistantGenderSource: 'manual',
      preferredName: 'Arisnachy',
    })
    const next = mergeUserProfile(current, { tone: 'direct and warm' })

    expect(next.assistantName).toBe('KIRA')
    expect(next.assistantGender).toBe('feminine')
    expect(next.assistantGenderSource).toBe('manual')
    expect(next.tone).toBe('direct and warm')
  })

  it('infers presentation only from explicit or assistant-addressed user language', () => {
    expect(inferAssistantGenderFromUserMessage('Gracias, Kira, eres una querida amiga.')).toEqual({
      gender: 'feminine',
      strength: 'addressed',
    })
    expect(inferAssistantGenderFromUserMessage('Phoenix, compañero, revisa esto por favor.')).toEqual({
      gender: 'masculine',
      strength: 'addressed',
    })
    expect(inferAssistantGenderFromUserMessage('Prefiero que te presentes de forma neutral.')).toEqual({
      gender: 'neutral',
      strength: 'explicit',
    })
    expect(inferAssistantGenderFromUserMessage('Mi esposa es una mujer muy querida.')).toBeUndefined()
  })

  it('recognizes direct explicit presentation changes without guessing from unrelated gender text', () => {
    expect(inferAssistantGenderFromUserMessage('Quiero que seas femenina y hables como mujer.')).toEqual({
      gender: 'feminine',
      strength: 'explicit',
    })
    expect(inferAssistantGenderFromUserMessage('I prefer you to be male and present as a man.')).toEqual({
      gender: 'masculine',
      strength: 'explicit',
    })
  })

  it('keeps Phoenix identity stable when the model-provider preference changes', () => {
    const before = profile({
      assistantName: 'Phoenix',
      assistantGender: 'feminine',
      modelProviderOrder: ['openrouter', 'openai-codex'],
    })
    const after = mergeUserProfile(before, {
      modelProviderOrder: ['openai-codex', 'openrouter'],
    })

    expect(after.assistantName).toBe('Phoenix')
    expect(after.assistantGender).toBe('feminine')
    expect(renderAssistantIdentity({
      name: after.assistantName,
      gender: after.assistantGender,
    })).toBe(renderAssistantIdentity({
      name: before.assistantName,
      gender: before.assistantGender,
    }))
  })

  it('places consent-filtered address in the durable system section, including fast turns', () => {
    const configured = mergeUserProfile(profile(), {
      preferredName: 'Aris', professionalTitle: 'Dr.', profession: 'Médico',
      addressingMode: 'automatic', tone: 'cercano, directo',
      consent: { preferredName: true, professionalTitle: true, tone: true },
    })
    const permitted = projectConsentedProfile(configured)
    const system = renderAssistantIdentity({ name: 'KIRA', gender: 'feminine' }, permitted)
    expect(system).toContain('Authorized preferred name: Aris')
    expect(system).toContain('Authorized professional title: Dr.')
    expect(system).toContain('Authorized conversational style: cercano, directo')
    expect(system).not.toContain('Médico')

    const revoked = projectConsentedProfile({ ...configured, consent: {
      ...configured.consent, preferredName: false, professionalTitle: false, tone: false,
    } })
    const privateSystem = renderAssistantIdentity({ name: 'KIRA', gender: 'feminine' }, revoked)
    expect(privateSystem).not.toContain('Aris')
    expect(privateSystem).not.toContain('Authorized professional title:')
    expect(privateSystem).not.toContain('cercano, directo')

    expect(renderHumanConnection(projectConsentedProfile(mergeUserProfile(configured, {
      addressingMode: 'none',
    })))).toContain('Do not address the user')
    const noConsent = projectConsentedProfile(mergeUserProfile(profile(), {
      preferredName: 'Aris', addressingMode: 'name',
    }))
    expect(renderHumanConnection(noConsent)).toContain('not authorized')
    expect(renderAssistantIdentity({ name: 'KIRA', gender: 'feminine' }, noConsent))
      .not.toContain('Authorized preferred name: Aris')
  })

  it('asks Kira to offer an actual idea rather than deflect during personal small talk', () => {
    const presence = renderAssistantIdentity({ name: 'KIRA', gender: 'feminine' })
    expect(presence).toContain('When the user asks “¿qué tienes en mente?”')
    expect(presence).toContain('answer with one concrete idea of your own')
    expect(presence).toContain('Do not deflect with “¿qué te gustaría hacer?”')
    expect(presence).toContain('rather than three consecutive acknowledgments')
  })

  it('renders a stable human-presence contract without exposing orchestration', () => {
    const text = renderAssistantIdentity({ name: 'KIRA', gender: 'feminine' })

    expect(text).toContain('<phoenix_human_presence>')
    expect(text).toContain('Assistant gender presentation: feminine')
    expect(text).toContain('use feminine forms such as “lista”, “activa”, “preparada” and “contenta”')
    expect(text).toContain('never use masculine forms such as “listo”, “activo”, “preparado” or “contento”')
    expect(text).toContain('never replace a configured presentation with a provider default')
    expect(text).toContain('Learn from corrections and outcomes')
    expect(text).toContain('Keep internal machinery private during ordinary conversation')
    expect(text).toContain('Do not repeatedly remind the user that you are an AI')
    expect(text).toContain('not a customer-support script')
    expect(text).toContain('silent behavior')
    expect(text).toContain('no meta preamble')
    expect(text).toContain('dry wit, mild sarcasm or irony')
    expect(text).toContain('Never turn silent guidance into a user-facing explanation')
    expect(text).toContain('Bind attributes to the exact person, project, or entity')
    expect(text).toContain('instead of filling the gap')
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

  it('rejects an assistant gender or provenance outside the supported presentation modes', () => {
    expect(() => { validateUserProfileUpdate({ assistantGender: 'robot' }) }).toThrow('assistantGender')
    expect(() => { validateUserProfileUpdate({ assistantGenderSource: 'provider' }) }).toThrow('assistantGenderSource')
  })

  it('rejects unknown consent keys and control characters', () => {
    expect(() => { validateUserProfileUpdate({ consent: { secret: true } }) }).toThrow('unknown user profile consent field')
    expect(() => { validateUserProfile(profile({ preferredName: 'bad\nname' })) }).toThrow('control character')
  })
})
