import { describe, expect, it } from 'vitest'
import { KIRA_SOCIAL_STYLE, TEAM_PERSONAS, teamPersonaGender, teamSocialStyle } from '../src/personas.ts'

describe('KIRA Team social personalities', () => {
  it('keeps all twenty specialists distinct and compact', () => {
    expect(TEAM_PERSONAS).toHaveLength(20)
    expect(new Set(TEAM_PERSONAS.map(persona => persona.kind)).size).toBe(20)
    expect(new Set(TEAM_PERSONAS.map(persona => persona.voice)).size).toBe(20)
    expect(TEAM_PERSONAS.every(persona => persona.gender === 'male' || persona.gender === 'female')).toBe(true)
    for (const persona of TEAM_PERSONAS) {
      expect(persona.voice.length).toBeGreaterThan(40)
      expect(persona.voice.length).toBeLessThan(230)
    }
  })

  it('gives Kira a human lead voice without trading away quality, speed, or cost', () => {
    const style = teamSocialStyle('lead', 'lead')
    expect(style).toContain(KIRA_SOCIAL_STYLE)
    expect(style).toContain('Humor, sarcasm, and emoji are optional and contextual')
    expect(style).toContain('high quality, fast completion, and low cost')
    expect(style).toContain('never degrade any of the three')
  })

  it('selects the real named specialist voice and preserves aliases', () => {
    expect(teamSocialStyle('argo', 'teammate')).toContain('detective-like')
    expect(teamSocialStyle('orion', 'teammate')).toContain('Playfully adversarial')
    expect(teamSocialStyle('zenith', 'teammate')).toContain('hard to impress')
    expect(teamSocialStyle('la-forja', 'teammate')).toContain('Calm, pragmatic, precise')
  })

  it('keeps approved persona gender explicit instead of guessing from names or avatars', () => {
    expect(teamPersonaGender('lead', 'lead')).toBe('female')
    expect(teamPersonaGender('Kira', 'lead')).toBe('female')
    expect(teamPersonaGender('la-forja', 'teammate')).toBe('male')
    expect(teamPersonaGender('orion', 'teammate')).toBe('male')
    expect(teamPersonaGender('aurora', 'teammate')).toBe('female')
    expect(teamSocialStyle('la-forja', 'teammate')).toContain('Your persona is male')
    expect(teamSocialStyle('la-forja', 'teammate')).toContain('listo/preparado')
    expect(teamSocialStyle('lead', 'lead')).toContain('Kira is feminine')
  })

  it('keeps unknown worker names natural instead of inventing a persona', () => {
    const style = teamSocialStyle('custom-worker', 'teammate')
    expect(style).toContain('Natural, concise, collegial')
    expect(style).toContain('persona gender is unspecified')
    expect(style).toContain('not a character performance')
    expect(teamPersonaGender('custom-worker', 'teammate')).toBeUndefined()
  })
})
