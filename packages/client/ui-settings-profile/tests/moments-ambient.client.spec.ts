import { describe, expect, it } from 'vitest'
import { appearanceFor, localDay, occasionFor } from '../src/client/MomentsAmbient.tsx'
import type { UserProfileSettings } from '../src/client/types.ts'

const consent: UserProfileSettings['consent'] = {
  preferredName: false, profession: false, professionalTitle: false, dateOfBirth: false,
  gender: false, pronouns: false, tone: false, family: false, moments: true,
}
function profile(patch: Partial<UserProfileSettings> = {}): UserProfileSettings {
  return {
    assistantName: 'KIRA',
    assistantGender: 'feminine',
    countryCode: 'DO',
    momentsTimeZone: 'America/Santo_Domingo',
    consent,
    ...patch,
  }
}

describe('compact PHOENIX Moments', () => {
  it('honors the user zone around midnight and does nothing without permission', () => {
    expect(localDay(new Date('2026-11-01T02:30:00Z'), 'America/Santo_Domingo')).toBe('2026-10-31')
    expect(occasionFor(profile({ consent: { ...consent, moments: false } }), '2026-10-31', [])).toBeUndefined()
    expect(occasionFor(profile(), '2026-10-30', [])).toBeUndefined()
  })

  it('chooses personal, solemn, patriotic and cultural events in order', () => {
    const p = profile({
      dateOfBirth: '1982-02-27',
      consent: { ...consent, dateOfBirth: true },
      specialDates: [{ date: '02-27', label: 'Aniversario importante', solemn: true }],
    })
    expect(occasionFor(p, '2026-02-27', [])).toEqual({ label: 'Tu cumpleaños', kind: 'personal' })
    expect(occasionFor(profile({ specialDates: p.specialDates }), '2026-02-27', [])).toEqual({
      label: 'Aniversario importante', kind: 'solemn',
    })
    expect(occasionFor(profile(), '2026-02-27', [])).toEqual({ label: 'Independencia Nacional', kind: 'patriotic' })
    expect(occasionFor(profile(), '2026-01-21', [])).toEqual({ label: 'Nuestra Señora de la Altagracia', kind: 'cultural' })
    expect(occasionFor(profile(), '2026-10-31', [])).toEqual({ label: 'Halloween', kind: 'cultural' })
  })

  it('filters remote country holidays and recognizes non-English patriotic names', () => {
    const holidays = [
      { countryCode: 'US', date: '2026-07-04', name: 'Independence Day', localName: 'Independencia' },
      { countryCode: 'CA', date: '2026-07-04', name: 'Other' },
    ]
    expect(occasionFor(profile({ countryCode: 'US' }), '2026-07-04', holidays)).toEqual({
      label: 'Independencia', kind: 'patriotic',
    })
    expect(occasionFor(profile({ countryCode: 'MX' }), '2026-07-04', holidays)).toBeUndefined()
    expect(occasionFor(profile({ countryCode: 'US' }), '2026-11-26', [])?.label).toBe('Acción de Gracias')
  })

  it('keeps regional movable dates on their correct Sundays', () => {
    expect(occasionFor(profile(), '2026-05-31', [])?.label).toBe('Día de las Madres')
    expect(occasionFor(profile(), '2026-07-26', [])?.label).toBe('Día de los Padres')
    expect(occasionFor(profile(), '2026-05-30', [])).toBeUndefined()
  })

  it('varies color and motif by occasion without changing the shell theme', () => {
    expect(appearanceFor({ label: 'Halloween', kind: 'cultural' })).toEqual({ icon: '🎃', theme: 'halloween' })
    expect(appearanceFor({ label: 'Navidad', kind: 'cultural' })).toEqual({ icon: '🎄', theme: 'winter' })
    expect(appearanceFor({ label: 'Cumpleaños', kind: 'personal' })).toEqual({ icon: '🎂', theme: 'birthday' })
    expect(appearanceFor({ label: 'Aniversario de boda', kind: 'personal' })).toEqual({ icon: '💝', theme: 'love' })
    expect(appearanceFor({ label: 'Día de la Tierra', kind: 'cultural' })).toEqual({ icon: '🌱', theme: 'nature' })
    expect(appearanceFor({ label: 'Homenaje', kind: 'solemn' })).toEqual({ icon: '🕯️', theme: 'solemn' })
    expect(appearanceFor({ label: 'Independencia Nacional', kind: 'patriotic' }, 'DO')).toEqual({
      icon: '🇩🇴', theme: 'patriotic',
    })
    expect(appearanceFor({ label: 'Día de la Paz', kind: 'cultural' })).toEqual({ icon: '✨', theme: 'general' })
  })
})
